/**
 * OpenClaw Integration - Direct integration with OpenClaw sessions
 * 
 * This module provides helpers for calling from within an OpenClaw session,
 * allowing the orchestrator to spawn real sub-agents.
 */

const fs = require('fs').promises;
const path = require('path');
const queue = require('../queue');
const agentManager = require('../agents');

/**
 * Prepare a work item for dispatch and return the sessions_spawn config
 * 
 * Call this from OpenClaw, then use the returned config with sessions_spawn
 */
async function prepareDispatch(workItemId) {
  // Get work item
  const items = await queue.list();
  const workItem = workItemId 
    ? items.find(i => i.id.startsWith(workItemId))
    : items.find(i => i.status === 'ready');
  
  if (!workItem) {
    return { error: 'No work item found' };
  }
  
  // Make sure it's ready
  if (!['ready', 'inbox', 'planning'].includes(workItem.status)) {
    return { error: `Item is ${workItem.status}, cannot dispatch` };
  }
  
  if (workItem.status !== 'ready') {
    await queue.ready(workItem.id);
  }
  
  // Spawn agent context (workspace, etc)
  const agentContext = await agentManager.spawn(workItem);
  
  // Update queue
  await queue.update(workItem.id, {
    status: 'in_flight',
    assignedAgentId: agentContext.agentId,
  });
  
  // Build the task prompt
  const task = buildTaskPrompt(workItem, agentContext);
  
  return {
    success: true,
    workItem: {
      id: workItem.id,
      title: workItem.title,
    },
    agent: {
      id: agentContext.agentId,
      workspaceDir: agentContext.workspaceDir,
      artifactsDir: agentContext.artifactsDir,
    },
    sessionsSpawnConfig: {
      task,
      label: `worker-${agentContext.agentId.slice(0, 8)}`,
      runTimeoutSeconds: 300,
      cleanup: 'keep',
    },
  };
}

/**
 * Build a comprehensive task prompt for the agent
 */
function buildTaskPrompt(workItem, agentContext) {
  return `# Isolated Work Assignment

You are a worker agent with a specific task. Work only within your designated directories.

## Your Workspace
- **Working Directory:** ${agentContext.workspaceDir}
- **Output Directory:** ${agentContext.artifactsDir}

## Task Details

**ID:** ${workItem.id}
**Title:** ${workItem.title}
**Priority:** ${workItem.priority}
**Complexity:** ${workItem.complexity}

### Description
${workItem.description || 'No additional description provided.'}

### Acceptance Criteria
${workItem.acceptanceCriteria?.length > 0 
  ? workItem.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  : 'Use your best judgment to deliver a complete solution.'}

## Instructions

1. Read any existing files in your workspace for context
2. Complete the task as described
3. Place ALL output files in: ${agentContext.artifactsDir}
4. When finished, create: ${agentContext.artifactsDir}/COMPLETION.md

### COMPLETION.md Format
\`\`\`markdown
# Completion Report

## Summary
[What you did]

## Files Created
- [List of files in artifacts/]

## Testing
[How to verify the work]

## Notes
[Any follow-up items or considerations]
\`\`\`

### If Blocked
Create ${agentContext.workspaceDir}/BLOCKED.md explaining:
- What you're stuck on
- What you need to proceed
- Any partial progress made

## Constraints
- Work ONLY within your workspace and artifacts directories
- Do not modify files outside these directories
- Do not access the internet unless required by the task
- Ask for clarification via BLOCKED.md if requirements are unclear

Begin working now.`;
}

/**
 * Check agent completion and finalize
 */
async function checkAndFinalize(agentId) {
  const result = await agentManager.checkCompletion(agentId);
  
  if (result.status === 'completed') {
    const session = agentManager.getSession(agentId);
    const artifacts = await agentManager.collectArtifacts(agentId);
    
    // Update queue
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
    
    return {
      status: 'completed',
      workItemId: session.workItemId,
      artifacts,
      completionReport: result.completionReport,
    };
  }
  
  if (result.status === 'blocked') {
    const session = agentManager.getSession(agentId);
    
    await queue.update(session.workItemId, {
      status: 'blocked',
    });
    
    return {
      status: 'blocked',
      workItemId: session.workItemId,
      blockerReport: result.blockerReport,
    };
  }
  
  return { status: 'working' };
}

/**
 * Get queue status summary for display
 */
async function getStatusSummary() {
  const items = await queue.list();
  const sessions = agentManager.listSessions();
  
  const byStatus = {};
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  
  return {
    queue: {
      total: items.length,
      inbox: byStatus.inbox || 0,
      ready: byStatus.ready || 0,
      inFlight: byStatus.in_flight || 0,
      review: byStatus.review || 0,
      done: byStatus.done || 0,
      blocked: byStatus.blocked || 0,
    },
    agents: {
      total: sessions.length,
      working: sessions.filter(s => s.status === 'working').length,
    },
    nextReady: items.find(i => i.status === 'ready'),
  };
}

module.exports = {
  prepareDispatch,
  checkAndFinalize,
  getStatusSummary,
};
