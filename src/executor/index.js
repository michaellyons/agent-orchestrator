/**
 * Executor - Runs isolated agent sessions
 * 
 * This is the execution engine that actually spawns agents
 * and manages their lifecycle.
 * 
 * Modes:
 * - mock: Simulated execution for testing
 * - spawn: Uses OpenClaw sessions_spawn (requires being called from OpenClaw)
 * - external: Outputs commands for external execution
 */

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const queue = require('../queue');
const agentManager = require('../agents');
const projects = require('../projects');
const { eventStream } = require('../events');
const repos = require('../repos');

class Executor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      mode: options.mode || 'external', // mock | spawn | external
      maxConcurrent: options.maxConcurrent || 2,
      model: options.model || 'sonnet',
      timeoutSeconds: options.timeoutSeconds || 300,
      ...options,
    };
    
    this.running = new Map(); // agentId -> execution state
    this.pendingSpawns = []; // Queue of items waiting to spawn
  }

  /**
   * Execute a single work item
   */
  async executeItem(workItemId) {
    // Get or find item
    const items = await queue.list();
    const workItem = items.find(i => i.id === workItemId || i.id.startsWith(workItemId));
    
    if (!workItem) {
      throw new Error(`Work item ${workItemId} not found`);
    }
    
    // Ensure ready
    if (!['ready', 'inbox', 'planning'].includes(workItem.status)) {
      throw new Error(`Item ${workItemId} is ${workItem.status}, cannot execute`);
    }
    
    if (workItem.status !== 'ready') {
      await queue.ready(workItem.id);
    }
    
    return this._spawn(workItem);
  }

  /**
   * Execute all ready items in a project
   */
  async executeProject(projectId) {
    const project = await projects.get(projectId);
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    // Ready all items first
    await projects.readyAll(project.id);
    
    // Get ready items
    const readyItems = project.workItems.filter(i => 
      ['ready', 'inbox', 'planning'].includes(i.status)
    );
    
    if (readyItems.length === 0) {
      return { projectId: project.id, spawned: 0, message: 'No items to execute' };
    }
    
    // Respect project's max concurrent
    const maxConcurrent = project.config?.maxConcurrent || this.options.maxConcurrent;
    const toSpawn = readyItems.slice(0, maxConcurrent);
    
    // Queue the rest
    const queued = readyItems.slice(maxConcurrent);
    this.pendingSpawns.push(...queued.map(i => i.id));
    
    // Spawn initial batch
    const results = [];
    for (const item of toSpawn) {
      const result = await this._spawn(item);
      results.push(result);
    }
    
    return {
      projectId: project.id,
      spawned: results.length,
      queued: queued.length,
      executions: results,
    };
  }

  /**
   * Execute next N ready items from queue
   */
  async executeNext(count = 1) {
    const readyItems = await queue.list('ready');
    
    if (readyItems.length === 0) {
      return { spawned: 0, message: 'No ready items in queue' };
    }
    
    // Sort by priority
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    readyItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    
    const toSpawn = readyItems.slice(0, count);
    const results = [];
    
    for (const item of toSpawn) {
      const result = await this._spawn(item);
      results.push(result);
    }
    
    return {
      spawned: results.length,
      executions: results,
    };
  }

  /**
   * Internal spawn method
   */
  async _spawn(workItem) {
    console.log(`\n🚀 Executing: ${workItem.title}`);
    
    // Create agent context
    const agentContext = await agentManager.spawn(workItem);
    
    // Update queue status
    await queue.update(workItem.id, {
      status: 'in_flight',
      assignedAgentId: agentContext.agentId,
    });
    
    // Build execution config
    const executionConfig = this._buildExecutionConfig(workItem, agentContext);
    
    // Track running
    this.running.set(agentContext.agentId, {
      workItemId: workItem.id,
      agentContext,
      startedAt: new Date().toISOString(),
      status: 'running',
    });
    
    await eventStream.publish('execution:started', {
      agentId: agentContext.agentId,
      workItemId: workItem.id,
      title: workItem.title,
    });
    
    // Execute based on mode
    switch (this.options.mode) {
      case 'mock':
        return this._executeMock(workItem, agentContext, executionConfig);
      
      case 'spawn':
        return this._executeSpawn(workItem, agentContext, executionConfig);
      
      case 'external':
      default:
        return this._executeExternal(workItem, agentContext, executionConfig);
    }
  }

  /**
   * Build the execution config (task prompt, etc)
   */
  _buildExecutionConfig(workItem, agentContext) {
    const task = `# Work Assignment

You are an isolated worker agent. Complete the task below within your designated workspace.

## Workspace
- **Working Directory:** ${agentContext.workspaceDir}
- **Output Directory:** ${agentContext.artifactsDir}

## Task

**${workItem.title}**

${workItem.description || ''}

${workItem.acceptanceCriteria?.length > 0 
  ? '### Acceptance Criteria\n' + workItem.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  : ''}

## Deliverables

1. Complete the task as specified
2. Place all output in: \`${agentContext.artifactsDir}\`
3. Create \`COMPLETION.md\` in artifacts when done:

\`\`\`markdown
# Completion Report
## Summary
[What you accomplished]
## Files
[List of artifacts created]
## Verification
[How to test/verify the work]
\`\`\`

4. If blocked, create \`BLOCKED.md\` in workspace explaining why

## Constraints
- Stay within your workspace directories
- Do not access files outside your workspace
- Focus only on this task

Begin now.`;

    return {
      task,
      label: `worker-${agentContext.agentId.slice(0, 8)}`,
      model: this.options.model,
      runTimeoutSeconds: this.options.timeoutSeconds,
      cleanup: 'keep',
    };
  }

  /**
   * Mock execution (for testing)
   */
  async _executeMock(workItem, agentContext, config) {
    console.log(`   [MOCK] Simulating work...`);
    
    // Simulate work
    await new Promise(r => setTimeout(r, 1500));
    
    // Create mock completion
    await fs.writeFile(
      path.join(agentContext.artifactsDir, 'COMPLETION.md'),
      `# Completion Report\n\n## Summary\n[MOCK] Simulated completion for: ${workItem.title}\n\n## Files\n- mock-output.txt\n`
    );
    
    await fs.writeFile(
      path.join(agentContext.artifactsDir, 'mock-output.txt'),
      `Mock output for task: ${workItem.title}\n`
    );
    
    // Finalize
    const artifacts = await agentManager.collectArtifacts(agentContext.agentId);
    await queue.complete(workItem.id, artifacts);
    
    this.running.delete(agentContext.agentId);
    
    await eventStream.publish('execution:completed', {
      agentId: agentContext.agentId,
      workItemId: workItem.id,
      artifacts: artifacts.length,
      mock: true,
    });
    
    console.log(`   [MOCK] Completed with ${artifacts.length} artifacts`);
    
    return {
      mode: 'mock',
      agentId: agentContext.agentId,
      workItemId: workItem.id,
      status: 'completed',
      artifacts,
    };
  }

  /**
   * External execution (returns config for manual spawn)
   */
  async _executeExternal(workItem, agentContext, config) {
    console.log(`   [EXTERNAL] Ready for manual spawn`);
    
    // Write task to file for reference
    await fs.writeFile(
      path.join(agentContext.workspaceDir, 'TASK.md'),
      config.task
    );
    
    return {
      mode: 'external',
      agentId: agentContext.agentId,
      workItemId: workItem.id,
      workspaceDir: agentContext.workspaceDir,
      artifactsDir: agentContext.artifactsDir,
      sessionsSpawnConfig: config,
      instructions: `
To execute this task, use OpenClaw sessions_spawn with:
  task: [see sessionsSpawnConfig.task]
  label: "${config.label}"
  runTimeoutSeconds: ${config.runTimeoutSeconds}

After completion, run:
  node orchestrate.js check ${agentContext.agentId}
`,
    };
  }

  /**
   * Direct spawn execution (called from within OpenClaw)
   * This would be used when orchestrator is running as part of OpenClaw
   */
  async _executeSpawn(workItem, agentContext, config) {
    // This returns the config - actual spawning happens via OpenClaw tool
    return {
      mode: 'spawn',
      agentId: agentContext.agentId,
      workItemId: workItem.id,
      workspaceDir: agentContext.workspaceDir,
      artifactsDir: agentContext.artifactsDir,
      sessionsSpawnConfig: config,
      // The caller (OpenClaw agent) should use sessions_spawn with this config
    };
  }

  /**
   * Check and finalize a running execution
   */
  async checkExecution(agentId) {
    const result = await agentManager.checkCompletion(agentId);
    const session = agentManager.getSession(agentId);
    
    if (!session) {
      return { error: 'Agent session not found' };
    }
    
    if (result.status === 'completed') {
      const artifacts = await agentManager.collectArtifacts(agentId);
      const workItem = await queue.get(session.workItemId);
      
      // Handle repo output if configured
      let repoOutput = null;
      if (workItem.output?.type === 'repo') {
        try {
          repoOutput = await this._createRepoOutput(workItem, artifacts, agentContext);
        } catch (err) {
          console.error('Repo creation failed:', err.message);
        }
      }
      
      await queue.update(session.workItemId, {
        status: 'review',
        artifacts: artifacts.map(a => ({
          id: a.id,
          type: a.type,
          path: a.path,
          description: a.name,
        })),
        repoOutput,
      });
      
      this.running.delete(agentId);
      
      await eventStream.publish('execution:completed', {
        agentId,
        workItemId: session.workItemId,
        artifacts: artifacts.length,
        repoOutput,
      });
      
      // Check for pending spawns
      this._processQueue();
      
      return {
        status: 'completed',
        workItemId: session.workItemId,
        artifacts,
        repoOutput,
        completionReport: result.completionReport,
      };
    }
    
    if (result.status === 'blocked') {
      await queue.update(session.workItemId, { status: 'blocked' });
      this.running.delete(agentId);
      
      await eventStream.publish('execution:blocked', {
        agentId,
        workItemId: session.workItemId,
      });
      
      return {
        status: 'blocked',
        workItemId: session.workItemId,
        blockerReport: result.blockerReport,
      };
    }
    
    return { status: 'running', workItemId: session.workItemId };
  }

  /**
   * Create repository output from artifacts
   */
  async _createRepoOutput(workItem, artifacts, agentContext) {
    const repoConfig = workItem.output;
    const repoName = repoConfig.name || `project-${workItem.id.slice(0, 8)}`;
    
    console.log(`📦 Creating repository: ${repoName}`);
    
    // Create repo via provider
    const repo = await repos.createRepo(repoName, {
      description: repoConfig.description || `Artifacts from: ${workItem.title}`,
      private: repoConfig.private !== false,
      template: repoConfig.template,
    });
    
    // Push artifacts
    if (artifacts.length > 0) {
      await repos.pushArtifacts(repo.cloneUrl, agentContext.artifactsDir, 
        `feat: deliverables from ${workItem.title}`);
    }
    
    console.log(`✅ Repository created: ${repo.url}`);
    
    return {
      provider: repo.provider,
      name: repo.name,
      url: repo.url,
      cloneUrl: repo.cloneUrl,
    };
  }

  /**
   * Process pending spawns queue
   */
  async _processQueue() {
    if (this.pendingSpawns.length === 0) return;
    if (this.running.size >= this.options.maxConcurrent) return;
    
    const nextId = this.pendingSpawns.shift();
    if (nextId) {
      await this.executeItem(nextId);
    }
  }

  /**
   * Get execution status
   */
  status() {
    return {
      mode: this.options.mode,
      maxConcurrent: this.options.maxConcurrent,
      running: this.running.size,
      pending: this.pendingSpawns.length,
      executions: Array.from(this.running.entries()).map(([id, state]) => ({
        agentId: id,
        workItemId: state.workItemId,
        startedAt: state.startedAt,
      })),
    };
  }
}

// Singleton
let executor = null;

function getExecutor(options) {
  if (!executor) {
    executor = new Executor(options);
  }
  return executor;
}

module.exports = { Executor, getExecutor };
