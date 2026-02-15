#!/usr/bin/env node

/**
 * Agent Worker
 * 
 * Subscribes to the orchestrator queue and executes work items.
 * Can run as standalone process or in Docker containers.
 * 
 * Environment:
 *   REDIS_URL - Redis connection string
 *   ORCHESTRATOR_URL - HTTP API endpoint  
 *   AGENT_ID - Unique agent identifier
 *   POLL_INTERVAL - How often to check for work (ms)
 *   EXECUTION_MODE - mock | spawn | external
 */

const { getAdapter, CHANNELS } = require('./src/queue/redis-adapter');
const crypto = require('crypto');

const AGENT_ID = process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000', 10);
const EXECUTION_MODE = process.env.EXECUTION_MODE || 'mock';

let queue = null;
let isWorking = false;
let currentWork = null;

/**
 * Execute a work item (simulated for now)
 */
async function executeWork(item) {
  console.log(`\n🔧 Executing: ${item.title}`);
  console.log(`   ID: ${item.id}`);
  console.log(`   Priority: ${item.priority}`);
  console.log(`   Mode: ${EXECUTION_MODE}`);

  isWorking = true;
  currentWork = item;

  try {
    if (EXECUTION_MODE === 'mock') {
      // Simulate work with random duration
      const duration = 3000 + Math.random() * 7000;
      console.log(`   ⏳ Working for ${Math.round(duration / 1000)}s...`);
      await new Promise(r => setTimeout(r, duration));

      // Mock artifacts
      const artifacts = [
        { id: crypto.randomBytes(4).toString('hex'), type: 'file', path: '/output/result.txt' },
      ];

      // Complete the work
      await queue.complete(item.id, artifacts);
      console.log(`   ✅ Completed with ${artifacts.length} artifact(s)`);

    } else if (EXECUTION_MODE === 'spawn') {
      // This would call OpenClaw sessions_spawn
      console.log(`   📡 Would spawn OpenClaw session for real execution`);
      console.log(`   [Not implemented - use orchestrator exec command]`);
      
      // For now, just mark complete
      await queue.complete(item.id, []);

    } else {
      // External mode - just log what would happen
      console.log(`   📋 External execution - work item ready at:`);
      console.log(`      ${ORCHESTRATOR_URL}/api/queue/${item.id}`);
    }

  } catch (err) {
    console.error(`   ❌ Execution failed:`, err.message);
    // Could update item status to 'blocked' here
  } finally {
    isWorking = false;
    currentWork = null;
  }
}

/**
 * Try to claim and execute work
 */
async function checkForWork() {
  if (isWorking) {
    return; // Already working
  }

  try {
    // Send heartbeat
    await queue.heartbeat(AGENT_ID, 'idle');

    // Try to claim work
    const item = await queue.claim(AGENT_ID);
    
    if (item) {
      await queue.heartbeat(AGENT_ID, 'working');
      await executeWork(item);
    }
  } catch (err) {
    console.error('Work check error:', err.message);
  }
}

/**
 * Handle work available notification
 */
function onWorkAvailable(data) {
  console.log(`\n📬 Work available: ${data.title} (${data.priority})`);
  
  if (!isWorking) {
    // Immediately try to claim
    checkForWork();
  }
}

/**
 * Start the agent worker
 */
async function start() {
  console.log(`
╔══════════════════════════════════════════╗
║         Agent Worker Starting            ║
╠══════════════════════════════════════════╣
║  ID:       ${AGENT_ID.padEnd(28)} ║
║  Mode:     ${EXECUTION_MODE.padEnd(28)} ║
║  Poll:     ${(POLL_INTERVAL + 'ms').padEnd(28)} ║
╚══════════════════════════════════════════╝
`);

  // Connect to queue
  queue = await getAdapter();
  console.log('✅ Connected to queue');

  // Subscribe to work notifications (if Redis available)
  try {
    await queue.subscribe(onWorkAvailable);
    console.log('✅ Subscribed to work events');
  } catch (err) {
    console.warn('⚠️ Could not subscribe to events, using polling only');
  }

  // Register initial heartbeat
  await queue.heartbeat(AGENT_ID, 'idle');
  console.log('✅ Registered with orchestrator');

  // Start polling loop
  console.log(`\n🔄 Starting work loop (poll every ${POLL_INTERVAL}ms)...\n`);
  
  setInterval(checkForWork, POLL_INTERVAL);
  
  // Check immediately
  checkForWork();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down agent...');
    await queue.heartbeat(AGENT_ID, 'offline');
    await queue.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n👋 Received SIGTERM, shutting down...');
    await queue.heartbeat(AGENT_ID, 'offline');
    await queue.disconnect();
    process.exit(0);
  });
}

start().catch(err => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
