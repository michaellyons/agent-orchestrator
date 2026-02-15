/**
 * Dispatcher - Orchestrates queue → agent flow
 * 
 * Watches for ready work items and dispatches them to agents.
 * Monitors agent progress and handles completion.
 */

const { EventEmitter } = require('events');
const queue = require('../queue');
const agentManager = require('../agents');

class Dispatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConcurrentAgents: options.maxConcurrentAgents || 1,
      pollIntervalMs: options.pollIntervalMs || 5000,
      completionCheckMs: options.completionCheckMs || 10000,
      ...options,
    };
    
    this.running = false;
    this.pollTimer = null;
    this.completionTimer = null;
    
    // Forward agent events
    agentManager.on('agent:spawned', (data) => this.emit('agent:spawned', data));
    agentManager.on('agent:status_changed', (data) => this.emit('agent:status_changed', data));
  }

  /**
   * Start the dispatcher loop
   */
  start() {
    if (this.running) return;
    
    this.running = true;
    this.emit('dispatcher:started');
    
    // Poll for ready items
    this.pollTimer = setInterval(() => this.poll(), this.options.pollIntervalMs);
    
    // Check for completions
    this.completionTimer = setInterval(
      () => this.checkCompletions(),
      this.options.completionCheckMs
    );
    
    // Initial poll
    this.poll();
    
    console.log('🚀 Dispatcher started');
    console.log(`   Max concurrent agents: ${this.options.maxConcurrentAgents}`);
    console.log(`   Poll interval: ${this.options.pollIntervalMs}ms`);
  }

  /**
   * Stop the dispatcher
   */
  stop() {
    if (!this.running) return;
    
    this.running = false;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    if (this.completionTimer) {
      clearInterval(this.completionTimer);
      this.completionTimer = null;
    }
    
    this.emit('dispatcher:stopped');
    console.log('⏹️  Dispatcher stopped');
  }

  /**
   * Poll for ready items and dispatch
   */
  async poll() {
    if (!this.running) return;
    
    try {
      // Check capacity
      const activeSessions = agentManager.listSessions('working');
      if (activeSessions.length >= this.options.maxConcurrentAgents) {
        return; // At capacity
      }
      
      // Get ready items
      const readyItems = await queue.list('ready');
      if (readyItems.length === 0) {
        return; // Nothing to dispatch
      }
      
      // Sort by priority
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      readyItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      
      // Dispatch highest priority
      const item = readyItems[0];
      await this.dispatch(item);
      
    } catch (err) {
      console.error('Poll error:', err.message);
      this.emit('dispatcher:error', { phase: 'poll', error: err });
    }
  }

  /**
   * Dispatch a work item to an agent
   */
  async dispatch(workItem) {
    console.log(`\n📤 Dispatching: ${workItem.title}`);
    
    // Spawn agent
    const { agentId, taskPrompt, workspaceDir } = await agentManager.spawn(workItem);
    
    // Update queue item
    await queue.update(workItem.id, {
      status: 'in_flight',
      assignedAgentId: agentId,
    });
    
    // Update agent status
    await agentManager.updateStatus(agentId, 'working');
    
    this.emit('work:dispatched', {
      workItemId: workItem.id,
      agentId,
      taskPrompt,
      workspaceDir,
    });
    
    console.log(`   Agent: ${agentId}`);
    console.log(`   Workspace: ${workspaceDir}`);
    
    return { agentId, taskPrompt, workspaceDir };
  }

  /**
   * Check all working agents for completion
   */
  async checkCompletions() {
    if (!this.running) return;
    
    const workingSessions = agentManager.listSessions('working');
    
    for (const session of workingSessions) {
      try {
        const result = await agentManager.checkCompletion(session.id);
        
        if (result.status === 'completed') {
          await this.handleCompletion(session, result);
        } else if (result.status === 'blocked') {
          await this.handleBlocked(session, result);
        }
      } catch (err) {
        console.error(`Completion check error for ${session.id}:`, err.message);
      }
    }
  }

  /**
   * Handle agent completion
   */
  async handleCompletion(session, result) {
    console.log(`\n✅ Agent ${session.id} completed`);
    
    // Collect artifacts
    const artifacts = await agentManager.collectArtifacts(session.id);
    console.log(`   Artifacts: ${artifacts.length} files`);
    
    // Update agent status
    await agentManager.updateStatus(session.id, 'completed', {
      completedAt: new Date().toISOString(),
      artifacts,
    });
    
    // Update queue item
    await queue.update(session.workItemId, {
      status: 'review',
      artifacts: artifacts.map(a => ({
        id: a.id,
        type: a.type,
        path: a.path,
        description: a.name,
        createdAt: a.createdAt,
      })),
    });
    
    this.emit('work:completed', {
      workItemId: session.workItemId,
      agentId: session.id,
      artifacts,
      completionReport: result.completionReport,
    });
  }

  /**
   * Handle blocked agent
   */
  async handleBlocked(session, result) {
    console.log(`\n🚫 Agent ${session.id} blocked`);
    console.log(`   Reason: ${result.blockerReport?.slice(0, 100)}...`);
    
    // Update agent status
    await agentManager.updateStatus(session.id, 'blocked', {
      blockedAt: new Date().toISOString(),
      blockerReport: result.blockerReport,
    });
    
    // Update queue item
    await queue.update(session.workItemId, {
      status: 'blocked',
    });
    
    this.emit('work:blocked', {
      workItemId: session.workItemId,
      agentId: session.id,
      blockerReport: result.blockerReport,
    });
  }

  /**
   * Manually trigger dispatch for a specific item
   */
  async dispatchItem(workItemId) {
    const item = await queue.get(workItemId);
    if (!item) {
      throw new Error(`Work item ${workItemId} not found`);
    }
    
    // Force to ready if in inbox/planning
    if (['inbox', 'planning'].includes(item.status)) {
      await queue.ready(workItemId);
      item.status = 'ready';
    }
    
    return this.dispatch(item);
  }

  /**
   * Get dispatcher status
   */
  status() {
    return {
      running: this.running,
      options: this.options,
      activeSessions: agentManager.listSessions('working').length,
      totalSessions: agentManager.listSessions().length,
    };
  }
}

// Singleton
let dispatcher = null;

function getDispatcher(options) {
  if (!dispatcher) {
    dispatcher = new Dispatcher(options);
  }
  return dispatcher;
}

module.exports = { Dispatcher, getDispatcher };
