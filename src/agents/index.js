/**
 * Agent Manager - Handles isolated agent sessions
 * 
 * Each agent gets:
 * - Isolated workspace directory
 * - Scoped context (only their work item)
 * - Artifact collection on completion
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '../../data');
const AGENTS_DIR = path.join(DATA_DIR, 'agents');

class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // agentId -> session info
  }

  /**
   * Create isolated workspace for an agent
   */
  async createWorkspace(agentId, workItem) {
    const workspaceDir = path.join(AGENTS_DIR, agentId, 'workspace');
    const artifactsDir = path.join(AGENTS_DIR, agentId, 'artifacts');
    
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });
    
    // Create scoped AGENTS.md with only relevant context
    const agentsContext = `# Agent Workspace

You are an isolated agent working on a specific task.

## Your Assignment

**Task ID:** ${workItem.id}
**Title:** ${workItem.title}
**Priority:** ${workItem.priority}
**Complexity:** ${workItem.complexity}

## Description

${workItem.description || 'No description provided.'}

## Acceptance Criteria

${workItem.acceptanceCriteria?.length > 0 
  ? workItem.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  : 'No specific criteria defined. Use your best judgment.'}

## Output

Place all artifacts in the \`artifacts/\` directory:
- Code files
- Documentation
- Test files
- Any other deliverables

When complete, create \`artifacts/COMPLETION.md\` with:
- Summary of what was done
- List of files created/modified
- Any notes or follow-up items

## Constraints

- Work only within this workspace
- Do not access external systems unless required by the task
- Ask for clarification by creating \`BLOCKED.md\` if stuck
`;

    await fs.writeFile(path.join(workspaceDir, 'AGENTS.md'), agentsContext);
    
    // Create work item reference
    await fs.writeFile(
      path.join(workspaceDir, 'WORK_ITEM.json'),
      JSON.stringify(workItem, null, 2)
    );
    
    return { workspaceDir, artifactsDir };
  }

  /**
   * Spawn an isolated agent session for a work item
   */
  async spawn(workItem, options = {}) {
    const agentId = crypto.randomBytes(8).toString('hex');
    
    // Create isolated workspace
    const { workspaceDir, artifactsDir } = await this.createWorkspace(agentId, workItem);
    
    // Build the task prompt
    const taskPrompt = this.buildTaskPrompt(workItem);
    
    const session = {
      id: agentId,
      workItemId: workItem.id,
      status: 'starting',
      workspaceDir,
      artifactsDir,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    
    this.sessions.set(agentId, session);
    this.emit('agent:spawned', { agentId, workItemId: workItem.id });
    
    return {
      agentId,
      taskPrompt,
      workspaceDir,
      artifactsDir,
      session,
    };
  }

  /**
   * Build the task prompt for the agent
   */
  buildTaskPrompt(workItem) {
    let prompt = `You are working on: "${workItem.title}"

`;
    
    if (workItem.description) {
      prompt += `Description: ${workItem.description}

`;
    }
    
    if (workItem.acceptanceCriteria?.length > 0) {
      prompt += `Acceptance Criteria:
${workItem.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

`;
    }
    
    prompt += `Complete this task. Place all output files in the artifacts/ directory.
When finished, create artifacts/COMPLETION.md summarizing what you did.
If you get stuck, create BLOCKED.md explaining the blocker.`;
    
    return prompt;
  }

  /**
   * Update agent status
   */
  async updateStatus(agentId, status, metadata = {}) {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    session.status = status;
    session.lastActivityAt = new Date().toISOString();
    Object.assign(session, metadata);
    
    this.emit('agent:status_changed', { agentId, status, ...metadata });
    
    return session;
  }

  /**
   * Check if agent has completed (COMPLETION.md exists)
   */
  async checkCompletion(agentId) {
    const session = this.sessions.get(agentId);
    if (!session) return null;
    
    const completionFile = path.join(session.artifactsDir, 'COMPLETION.md');
    const blockedFile = path.join(session.workspaceDir, 'BLOCKED.md');
    
    try {
      await fs.access(completionFile);
      const content = await fs.readFile(completionFile, 'utf8');
      return { status: 'completed', completionReport: content };
    } catch {
      // Check for blocked
      try {
        await fs.access(blockedFile);
        const content = await fs.readFile(blockedFile, 'utf8');
        return { status: 'blocked', blockerReport: content };
      } catch {
        return { status: 'working' };
      }
    }
  }

  /**
   * Collect artifacts from completed agent
   */
  async collectArtifacts(agentId) {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const artifacts = [];
    
    try {
      const files = await fs.readdir(session.artifactsDir);
      
      for (const file of files) {
        const filePath = path.join(session.artifactsDir, file);
        const stat = await fs.stat(filePath);
        
        if (stat.isFile()) {
          artifacts.push({
            id: crypto.randomBytes(4).toString('hex'),
            type: 'file',
            name: file,
            path: filePath,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
          });
        }
      }
    } catch (err) {
      // No artifacts directory or empty
    }
    
    return artifacts;
  }

  /**
   * Get session info
   */
  getSession(agentId) {
    return this.sessions.get(agentId);
  }

  /**
   * List all sessions
   */
  listSessions(status = null) {
    const sessions = Array.from(this.sessions.values());
    if (status) {
      return sessions.filter(s => s.status === status);
    }
    return sessions;
  }

  /**
   * Clean up agent workspace (optional, after artifacts collected)
   */
  async cleanup(agentId, keepArtifacts = true) {
    const session = this.sessions.get(agentId);
    if (!session) return;
    
    if (!keepArtifacts) {
      const agentDir = path.join(AGENTS_DIR, agentId);
      await fs.rm(agentDir, { recursive: true, force: true });
    }
    
    this.sessions.delete(agentId);
    this.emit('agent:cleaned', { agentId });
  }
}

// Singleton instance
const agentManager = new AgentManager();

module.exports = agentManager;
