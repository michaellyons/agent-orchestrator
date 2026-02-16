/**
 * Queue Manager - Local JSON-file implementation
 * 
 * Phase 1: Simple file-based queue for prototyping
 * Phase 2: Swap to DynamoDB/SQS
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const QUEUE_FILE = path.join(__dirname, '../../data/queue.json');

// Simple in-memory lock for concurrent file access
let fileLock = Promise.resolve();

/**
 * Execute a function with exclusive file access
 */
async function withLock(fn) {
  const previousLock = fileLock;
  let releaseLock;
  fileLock = new Promise(resolve => { releaseLock = resolve; });
  
  await previousLock;
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.dirname(QUEUE_FILE);
  await fs.mkdir(dataDir, { recursive: true });
}

// Load queue from disk (internal - use withLock wrapper)
async function loadQueueInternal() {
  try {
    const data = await fs.readFile(QUEUE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { items: [], agents: [] };
    }
    throw err;
  }
}

// Save queue to disk (internal - use withLock wrapper)
async function saveQueueInternal(queue) {
  await ensureDataDir();
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// Public wrappers for backwards compatibility
async function loadQueue() {
  return loadQueueInternal();
}

async function saveQueue(queue) {
  return saveQueueInternal(queue);
}

// Generate unique ID
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Add a work item to the queue
 */
async function enqueue(item) {
  return withLock(async () => {
    const queue = await loadQueueInternal();
    
    const workItem = {
      id: generateId(),
      title: item.title,
      description: item.description || '',
      acceptanceCriteria: item.acceptanceCriteria || [],
      status: 'inbox',
      priority: item.priority || 'medium',
      complexity: item.complexity || 'm',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: item.createdBy || 'unknown',
      artifacts: [],
      blockedBy: [],
      blocks: [],
    };
    
    queue.items.push(workItem);
    await saveQueueInternal(queue);
    
    return workItem;
  });
}

/**
 * Get all items, optionally filtered by status
 */
async function list(status = null) {
  const queue = await loadQueue();
  
  if (status) {
    return queue.items.filter(item => item.status === status);
  }
  
  return queue.items;
}

/**
 * Get a single item by ID
 */
async function get(id) {
  const queue = await loadQueue();
  return queue.items.find(item => item.id === id);
}

/**
 * Update a work item
 */
async function update(id, updates) {
  return withLock(async () => {
    const queue = await loadQueueInternal();
    const index = queue.items.findIndex(item => item.id === id);
    
    if (index === -1) {
      throw new Error(`Work item ${id} not found`);
    }
    
    queue.items[index] = {
      ...queue.items[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    
    await saveQueueInternal(queue);
    return queue.items[index];
  });
}

/**
 * Claim the next ready work item
 */
async function claim(agentId) {
  return withLock(async () => {
    const queue = await loadQueueInternal();
    
    // Priority order: urgent > high > medium > low
    const priorityOrder = ['urgent', 'high', 'medium', 'low'];
    
    // Find highest priority 'ready' item
    let nextItem = null;
    for (const priority of priorityOrder) {
      nextItem = queue.items.find(
        item => item.status === 'ready' && item.priority === priority
      );
      if (nextItem) break;
    }
    
    if (!nextItem) {
      return null; // Queue empty or no ready items
    }
    
    // Claim it
    const index = queue.items.findIndex(item => item.id === nextItem.id);
    queue.items[index] = {
      ...queue.items[index],
      status: 'in_flight',
      assignedAgentId: agentId,
      updatedAt: new Date().toISOString(),
    };
    
    await saveQueueInternal(queue);
    return queue.items[index];
  });
}

/**
 * Move item to ready status (after planning/scoping)
 */
async function ready(id) {
  return update(id, { status: 'ready' });
}

/**
 * Complete a work item
 */
async function complete(id, artifacts = []) {
  return update(id, { 
    status: 'done',
    artifacts,
    assignedAgentId: null,
    assignedSessionKey: null,
  });
}

/**
 * Get queue statistics
 */
async function stats() {
  const queue = await loadQueue();
  
  const byStatus = {};
  for (const item of queue.items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  
  return {
    total: queue.items.length,
    byStatus,
    activeAgents: queue.agents.filter(a => a.status === 'working').length,
  };
}

module.exports = {
  enqueue,
  list,
  get,
  update,
  claim,
  ready,
  complete,
  stats,
  loadQueue,
  saveQueue,
};
