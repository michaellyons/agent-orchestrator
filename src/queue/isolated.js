/**
 * Isolated Queue - Per-project queue management
 * 
 * Each project has its own queue file with complete isolation.
 * No shared state between projects.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { getProjectPaths } = require('../projects');

// Project-scoped locks
const projectLocks = new Map();

function getLock(projectId) {
  if (!projectLocks.has(projectId)) {
    projectLocks.set(projectId, Promise.resolve());
  }
  return projectLocks.get(projectId);
}

function setLock(projectId, lock) {
  projectLocks.set(projectId, lock);
}

/**
 * Execute with exclusive project-scoped lock
 */
async function withProjectLock(projectId, fn) {
  const previousLock = getLock(projectId);
  let releaseLock;
  const newLock = new Promise(resolve => { releaseLock = resolve; });
  setLock(projectId, newLock);
  
  await previousLock;
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

/**
 * Load queue for specific project
 */
async function loadQueue(projectId) {
  const paths = getProjectPaths(projectId);
  
  try {
    const data = await fs.readFile(paths.queue, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Initialize empty queue
      return { items: [], version: 1 };
    }
    throw err;
  }
}

/**
 * Save queue for specific project
 */
async function saveQueue(projectId, queue) {
  const paths = getProjectPaths(projectId);
  await fs.mkdir(path.dirname(paths.queue), { recursive: true });
  await fs.writeFile(paths.queue, JSON.stringify(queue, null, 2));
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Add work item to project queue
 */
async function enqueue(projectId, item) {
  return withProjectLock(projectId, async () => {
    const queue = await loadQueue(projectId);
    
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
      output: item.output || null,
    };
    
    queue.items.push(workItem);
    await saveQueue(projectId, queue);
    
    return workItem;
  });
}

/**
 * List items in project queue
 */
async function list(projectId, status = null) {
  const queue = await loadQueue(projectId);
  
  if (status) {
    return queue.items.filter(item => item.status === status);
  }
  
  return queue.items;
}

/**
 * Get single item from project
 */
async function get(projectId, id) {
  const queue = await loadQueue(projectId);
  return queue.items.find(item => item.id === id);
}

/**
 * Update item in project
 */
async function update(projectId, id, updates) {
  return withProjectLock(projectId, async () => {
    const queue = await loadQueue(projectId);
    const index = queue.items.findIndex(item => item.id === id);
    
    if (index === -1) {
      throw new Error(`Work item ${id} not found in project ${projectId}`);
    }
    
    queue.items[index] = {
      ...queue.items[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    
    await saveQueue(projectId, queue);
    return queue.items[index];
  });
}

/**
 * Claim next ready item from project
 */
async function claim(projectId, agentId) {
  return withProjectLock(projectId, async () => {
    const queue = await loadQueue(projectId);
    
    const priorityOrder = ['urgent', 'high', 'medium', 'low'];
    
    let nextItem = null;
    for (const priority of priorityOrder) {
      nextItem = queue.items.find(
        item => item.status === 'ready' && item.priority === priority
      );
      if (nextItem) break;
    }
    
    if (!nextItem) return null;
    
    const index = queue.items.findIndex(item => item.id === nextItem.id);
    queue.items[index] = {
      ...queue.items[index],
      status: 'in_flight',
      assignedAgentId: agentId,
      updatedAt: new Date().toISOString(),
    };
    
    await saveQueue(projectId, queue);
    return queue.items[index];
  });
}

/**
 * Mark item as ready
 */
async function ready(projectId, id) {
  return update(projectId, id, { status: 'ready' });
}

/**
 * Mark item as complete
 */
async function complete(projectId, id, artifacts = []) {
  return update(projectId, id, {
    status: 'done',
    artifacts,
    assignedAgentId: null,
    completedAt: new Date().toISOString(),
  });
}

/**
 * Get project stats
 */
async function stats(projectId) {
  const items = await list(projectId);
  
  return {
    total: items.length,
    byStatus: {
      inbox: items.filter(i => i.status === 'inbox').length,
      ready: items.filter(i => i.status === 'ready').length,
      in_flight: items.filter(i => i.status === 'in_flight').length,
      done: items.filter(i => i.status === 'done').length,
      blocked: items.filter(i => i.status === 'blocked').length,
    },
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
};
