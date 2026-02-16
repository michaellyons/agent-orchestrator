/**
 * OpenClaw Integration for Agent Orchestrator
 * 
 * Use with sessions_spawn to execute "in flight" work items.
 * 
 * Example:
 * sessions_spawn({
 *   task: orchestrator.getTaskForSpawn('work-item-id'),
 *   label: 'orchestrator-worker',
 *   model: 'codex',  // Use Codex for coding phase
 * })
 */

const queue = require('./queue');
const { getExecutor } = require('./executor');

/**
 * Get spawn-ready task config for a work item
 * Prepares workspace, returns task + paths
 */
async function getTaskForSpawn(workItemId) {
  const executor = getExecutor({ mode: 'external' });
  
  // Execute item (prepares workspace)
  const result = await executor.executeItem(workItemId);
  
  if (!result.workspaceDir) {
    throw new Error(`Failed to prepare workspace for ${workItemId}`);
  }
  
  // Build enhanced task with workspace info
  const enhancedTask = `${result.sessionsSpawnConfig.task}

---

## Execution Context
- **Workspace**: ${result.workspaceDir}
- **Artifacts Directory**: ${result.artifactsDir}  
- **Agent ID**: ${result.agentId}

## Critical Instructions
1. ALL output files must go in: ${result.artifactsDir}
2. Stay within workspace: ${result.workspaceDir}
3. Create COMPLETION.md in artifacts when done
4. If blocked, create BLOCKED.md in workspace

Begin now.`;

  return {
    task: enhancedTask,
    label: result.sessionsSpawnConfig.label,
    agentId: result.agentId,
    workspaceDir: result.workspaceDir,
    artifactsDir: result.artifactsDir,
  };
}

/**
 * Complete work item after agent finishes
 */
async function completeFromAgent(agentId) {
  const { checkExecution } = getExecutor();
  const result = await checkExecution(agentId);
  return result;
}

/**
 * List "in flight" items ready for agent execution
 */
async function listReadyForSpawn() {
  const items = await queue.list('ready');
  return items;
}

/**
 * Full auto-execution pipeline
 * Kimi (planning) → Queue → Spawn → Codex (coding) → Complete
 */
async function executeWithModelRouting(workItemId, options = {}) {
  const { planningModel = 'kimi', codingModel = 'codex' } = options;
  
  // Phase 1: Planning (Kimi K2.5)
  console.log(`[Planning] Using ${planningModel}...`);
  const spawnConfig = await getTaskForSpawn(workItemId);
  
  // Phase 2: Coding (Codex)
  console.log(`[Coding] Spawning ${codingModel}...`);
  console.log(`Task ready for sessions_spawn:`);
  console.log(`  label: "${spawnConfig.label}"`);
  console.log(`  workspace: "${spawnConfig.workspaceDir}"`);
  
  // Return spawn config - caller uses sessions_spawn
  return {
    phase: 'ready_for_spawn',
    spawnConfig: {
      task: spawnConfig.task,
      label: spawnConfig.label,
      model: codingModel === 'codex' ? 'gpt-5.2-codex' : codingModel,
      runTimeoutSeconds: 600,
      cleanup: 'keep',
    },
    agentId: spawnConfig.agentId,
    workItemId,
    onComplete: () => completeFromAgent(spawnConfig.agentId),
  };
}

module.exports = {
  getTaskForSpawn,
  completeFromAgent,
  listReadyForSpawn,
  executeWithModelRouting,
};
