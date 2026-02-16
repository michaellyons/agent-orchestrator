#!/usr/bin/env node

/**
 * Spawn Codex for "In Flight" Orchestrator Tasks
 * 
 * Model routing: Kimi K2.5 (planning) → Codex (implementation)
 * 
 * Usage:
 *   ./spawn-codex.js <work-item-id>
 *   ./spawn-codex.js 881c2bd3
 */

const { exec } = require('./src/queue');
const { getExecutor } = require('./src/executor');

async function spawnCodexForTask(workItemId) {
  const executor = getExecutor({ mode: 'external' });
  
  // Execute item (prepares workspace)
  console.log(`🚀 Preparing workspace for ${workItemId}...`);
  const result = await executor.executeItem(workItemId);
  
  if (!result.workspaceDir) {
    console.error('❌ Failed to prepare workspace');
    process.exit(1);
  }
  
  const { workspaceDir, artifactsDir, agentId, sessionsSpawnConfig } = result;
  
  console.log(`\n📁 Workspace: ${workspaceDir}`);
  console.log(`📦 Artifacts: ${artifactsDir}`);
  console.log(`🤖 Agent ID: ${agentId}`);
  
  // Output Codex command
  console.log(`\n💻 Run this to spawn Codex:`);
  console.log(`\nbash pty:true workdir:${workspaceDir} background:true command:"codex --yolo exec 'Complete the task in TASK.md. Place all output in ${artifactsDir}'"`);
  
  // Alternative: return spawn config for OpenClaw integration
  console.log(`\n🔧 OpenClaw sessions_spawn config:`);
  console.log(JSON.stringify({
    task: sessionsSpawnConfig.task,
    label: sessionsSpawnConfig.label,
    runTimeoutSeconds: sessionsSpawnConfig.runTimeoutSeconds,
    model: 'gpt-5.2-codex',  // Codex model for coding
  }, null, 2));
  
  console.log(`\n✅ After Codex finishes, check with:`);
  console.log(`node cli.js check ${agentId}`);
}

// CLI
const workItemId = process.argv[2];
if (!workItemId) {
  console.error('Usage: ./spawn-codex.js <work-item-id>');
  process.exit(1);
}

spawnCodexForTask(workItemId).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
