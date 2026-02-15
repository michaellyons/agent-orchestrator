/**
 * Project Manager - Group related work items
 * 
 * Projects bundle tasks that belong together:
 * - Feature builds (multiple components)
 * - Research spikes (parallel exploration)
 * - Batch operations (similar tasks)
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const queue = require('../queue');

const PROJECTS_FILE = path.join(__dirname, '../../data/projects.json');

async function loadProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { projects: [] };
    }
    throw err;
  }
}

async function saveProjects(data) {
  const dir = path.dirname(PROJECTS_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Create a new project
 */
async function create(project) {
  const data = await loadProjects();
  
  const newProject = {
    id: generateId(),
    name: project.name,
    description: project.description || '',
    status: 'planning', // planning | active | paused | completed
    workItemIds: [],
    config: {
      maxConcurrent: project.maxConcurrent || 2,
      isolation: project.isolation || 'full', // full | shared | none
      ...project.config,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  data.projects.push(newProject);
  await saveProjects(data);
  
  return newProject;
}

/**
 * Add work item to project
 */
async function addWorkItem(projectId, workItemData) {
  const data = await loadProjects();
  const project = data.projects.find(p => p.id === projectId || p.id.startsWith(projectId));
  
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  
  // Create the work item
  const workItem = await queue.enqueue({
    ...workItemData,
    projectId: project.id,
  });
  
  // Link to project
  project.workItemIds.push(workItem.id);
  project.updatedAt = new Date().toISOString();
  
  await saveProjects(data);
  
  return { project, workItem };
}

/**
 * Add multiple work items to project
 */
async function addWorkItems(projectId, items) {
  const results = [];
  for (const item of items) {
    const result = await addWorkItem(projectId, item);
    results.push(result.workItem);
  }
  return results;
}

/**
 * Get project with its work items
 */
async function get(projectId) {
  const data = await loadProjects();
  const project = data.projects.find(p => p.id === projectId || p.id.startsWith(projectId));
  
  if (!project) {
    return null;
  }
  
  // Fetch work items
  const allItems = await queue.list();
  const workItems = allItems.filter(item => project.workItemIds.includes(item.id));
  
  return {
    ...project,
    workItems,
    progress: calculateProgress(workItems),
  };
}

/**
 * List all projects
 */
async function list(status = null) {
  const data = await loadProjects();
  let projects = data.projects;
  
  if (status) {
    projects = projects.filter(p => p.status === status);
  }
  
  // Add summary stats
  const allItems = await queue.list();
  
  return projects.map(project => {
    const workItems = allItems.filter(item => project.workItemIds.includes(item.id));
    return {
      ...project,
      itemCount: workItems.length,
      progress: calculateProgress(workItems),
    };
  });
}

/**
 * Calculate project progress
 */
function calculateProgress(workItems) {
  if (workItems.length === 0) {
    return { percent: 0, done: 0, total: 0, inFlight: 0, blocked: 0 };
  }
  
  const done = workItems.filter(i => i.status === 'done').length;
  const review = workItems.filter(i => i.status === 'review').length;
  const inFlight = workItems.filter(i => i.status === 'in_flight').length;
  const blocked = workItems.filter(i => i.status === 'blocked').length;
  
  return {
    percent: Math.round(((done + review) / workItems.length) * 100),
    done,
    review,
    inFlight,
    blocked,
    ready: workItems.filter(i => i.status === 'ready').length,
    total: workItems.length,
  };
}

/**
 * Mark all project items as ready
 */
async function readyAll(projectId) {
  const project = await get(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  
  const updated = [];
  for (const item of project.workItems) {
    if (['inbox', 'planning'].includes(item.status)) {
      await queue.ready(item.id);
      updated.push(item.id);
    }
  }
  
  // Update project status
  const data = await loadProjects();
  const proj = data.projects.find(p => p.id === project.id);
  if (proj) {
    proj.status = 'active';
    proj.updatedAt = new Date().toISOString();
    await saveProjects(data);
  }
  
  return { projectId: project.id, readiedCount: updated.length };
}

/**
 * Update project
 */
async function update(projectId, updates) {
  const data = await loadProjects();
  const index = data.projects.findIndex(p => p.id === projectId || p.id.startsWith(projectId));
  
  if (index === -1) {
    throw new Error(`Project ${projectId} not found`);
  }
  
  data.projects[index] = {
    ...data.projects[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveProjects(data);
  return data.projects[index];
}

module.exports = {
  create,
  addWorkItem,
  addWorkItems,
  get,
  list,
  readyAll,
  update,
  loadProjects,
  saveProjects,
};
