/**
 * Project-Scoped Executor
 * 
 * Each project has isolated agent workspaces.
 * Agents cannot access files outside their project directory.
 */

const fs = require('fs').promises;
const path = require('path');
const { getProjectPaths } = require('../projects');
const queue = require('../queue/isolated');
const crypto = require('crypto');

class ProjectExecutor {
  constructor(projectId, options = {}) {
    this.projectId = projectId;
    this.options = {
      mode: options.mode || 'external',
      maxConcurrent: options.maxConcurrent || 2,
      model: options.model || 'kimi',
      timeoutSeconds: options.timeoutSeconds || 300,
      ...options,
    };
    this.running = new Map();
    this.paths = getProjectPaths(projectId);
  }

  /**
   * Get agent workspace paths (isolated to project)
   */
  async getAgentWorkspace(agentId) {
    const workspaceDir = path.join(this.paths.agents, agentId, 'workspace');
    const artifactsDir = path.join(this.paths.agents, agentId, 'artifacts');
    
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });
    
    return { workspaceDir, artifactsDir };
  }

  /**
   * Execute work item in isolated project workspace
   */
  async executeItem(workItemId) {
    const items = await queue.list(this.projectId);
    const workItem = items.find(i => 
      i.id === workItemId || i.id.startsWith(workItemId)
    );
    
    if (!workItem) {
      throw new Error(`Work item ${workItemId} not found in project ${this.projectId}`);
    }
    
    // Ensure ready
    if (!['ready', 'inbox', 'planning'].includes(workItem.status)) {
      throw new Error(`Item ${workItemId} is ${workItem.status}, cannot execute`);
    }
    
    if (workItem.status !== 'ready') {
      await queue.ready(this.projectId, workItem.id);
    }
    
    return this._spawn(workItem);
  }

  /**
   * Spawn agent with isolated workspace
   */
  async _spawn(workItem) {
    const agentId = crypto.randomBytes(8).toString('hex');
    const { workspaceDir, artifactsDir } = await this.getAgentWorkspace(agentId);
    
    // Create TASK.md
    const taskContent = this._buildTaskContent(workItem, workspaceDir, artifactsDir);
    await fs.writeFile(path.join(workspaceDir, 'TASK.md'), taskContent);
    
    // Create metadata
    await fs.writeFile(
      path.join(path.dirname(workspaceDir), 'WORK_ITEM.json'),
      JSON.stringify({
        workItemId: workItem.id,
        agentId,
        projectId: this.projectId,
        startedAt: new Date().toISOString(),
      }, null, 2)
    );
    
    this.running.set(agentId, {
      workItemId: workItem.id,
      startedAt: new Date(),
      workspaceDir,
      artifactsDir,
    });
    
    const config = {
      task: taskContent,
      label: `worker-${agentId.slice(0, 8)}`,
      model: this.options.model,
      runTimeoutSeconds: this.options.timeoutSeconds,
      cleanup: 'keep',
    };
    
    return {
      mode: this.options.mode,
      agentId,
      workItemId: workItem.id,
      projectId: this.projectId,
      workspaceDir,
      artifactsDir,
      sessionsSpawnConfig: config,
    };
  }

  /**
   * Build task content with strict isolation
   */
  _buildTaskContent(workItem, workspaceDir, artifactsDir) {
    return `# Work Assignment - ISOLATED

⚠️ **CRITICAL: You are in an isolated project environment**
- Project ID: ${this.projectId}
- Agent ID: Worker assigned to this task
- **You CANNOT access files outside these directories**

## Workspace Boundaries
- **Working Directory**: ${workspaceDir}
- **Output Directory**: ${artifactsDir}
- **Project Root**: ${this.paths.root}

## Task

**${workItem.title}**

${workItem.description || ''}

${workItem.acceptanceCriteria?.length > 0 
  ? '### Acceptance Criteria\n' + workItem.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  : ''}

## Deliverables

1. ALL output must go in: \`${artifactsDir}\`
2. Create \`COMPLETION.md\` in artifacts directory when done
3. If blocked, create \`BLOCKED.md\` in workspace
4. **Never access files outside your workspace boundaries**

## Verification

When complete, verify:
- [ ] All files in ${artifactsDir}
- [ ] COMPLETION.md exists
- [ ] No files created outside workspace

Begin now.`;
  }

  /**
   * Check agent completion
   */
  async checkCompletion(agentId) {
    const session = this.running.get(agentId);
    if (!session) {
      return { error: 'Agent session not found' };
    }
    
    const completionFile = path.join(session.artifactsDir, 'COMPLETION.md');
    const blockedFile = path.join(session.workspaceDir, 'BLOCKED.md');
    
    try {
      await fs.access(completionFile);
      const completionContent = await fs.readFile(completionFile, 'utf8');
      
      // Collect artifacts
      const artifacts = await this._collectArtifacts(session.artifactsDir);
      
      // Complete work item
      await queue.complete(this.projectId, session.workItemId, artifacts);
      this.running.delete(agentId);
      
      return {
        status: 'completed',
        workItemId: session.workItemId,
        artifacts,
        completionReport: completionContent,
      };
    } catch (err) {
      // Check if blocked
      try {
        await fs.access(blockedFile);
        const blockerContent = await fs.readFile(blockedFile, 'utf8');
        await queue.update(this.projectId, session.workItemId, { status: 'blocked' });
        this.running.delete(agentId);
        
        return {
          status: 'blocked',
          workItemId: session.workItemId,
          blockerReport: blockerContent,
        };
      } catch (e) {
        return { status: 'running', workItemId: session.workItemId };
      }
    }
  }

  /**
   * Collect artifacts from isolated directory
   */
  async _collectArtifacts(artifactsDir) {
    try {
      const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
      const artifacts = [];
      
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          const filePath = path.join(artifactsDir, entry.name);
          const stats = await fs.stat(filePath);
          artifacts.push({
            id: crypto.randomBytes(4).toString('hex'),
            name: entry.name,
            type: path.extname(entry.name).slice(1) || 'file',
            path: filePath,
            size: stats.size,
          });
        }
      }
      
      return artifacts;
    } catch (err) {
      return [];
    }
  }

  /**
   * Get executor status
   */
  status() {
    return {
      projectId: this.projectId,
      mode: this.options.mode,
      maxConcurrent: this.options.maxConcurrent,
      running: this.running.size,
      executions: Array.from(this.running.entries()).map(([id, state]) => ({
        agentId: id,
        workItemId: state.workItemId,
        startedAt: state.startedAt,
      })),
    };
  }
}

module.exports = { ProjectExecutor };
