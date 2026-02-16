/**
 * Project Manager - Multi-tenant isolation
 * 
 * Each project is completely isolated:
 * - Separate data directory
 * - Separate queue file
 * - Separate agent workspaces
 * - No cross-project contamination
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = path.join(__dirname, '../../data/projects');

// Ensure projects root exists
async function ensureProjectsRoot() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

/**
 * Generate unique project ID
 */
function generateProjectId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create new isolated project environment
 */
async function createProject(name, options = {}) {
  await ensureProjectsRoot();
  
  const projectId = generateProjectId();
  const projectDir = path.join(DATA_ROOT, projectId);
  
  // Create project structure
  const dirs = [
    projectDir,
    path.join(projectDir, 'queue'),
    path.join(projectDir, 'agents'),
    path.join(projectDir, 'artifacts'),
    path.join(projectDir, 'config'),
  ];
  
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
  
  // Initialize empty queue
  const queueFile = path.join(projectDir, 'queue', 'items.json');
  await fs.writeFile(queueFile, JSON.stringify({ items: [], version: 1 }, null, 2));
  
  // Create project metadata
  const meta = {
    id: projectId,
    name,
    description: options.description || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: {
      maxConcurrent: options.maxConcurrent || 2,
      defaultModel: options.defaultModel || 'kimi',
      allowRepoCreation: options.allowRepoCreation !== false,
      ...options.config,
    },
    stats: {
      totalItems: 0,
      completedItems: 0,
    },
  };
  
  const metaFile = path.join(projectDir, 'config', 'meta.json');
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2));
  
  return meta;
}

/**
 * Get project metadata
 */
async function getProject(projectId) {
  const metaFile = path.join(DATA_ROOT, projectId, 'config', 'meta.json');
  try {
    const data = await fs.readFile(metaFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * List all projects
 */
async function listProjects() {
  await ensureProjectsRoot();
  
  try {
    const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
    const projects = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const project = await getProject(entry.name);
        if (project) projects.push(project);
      }
    }
    
    return projects;
  } catch (err) {
    return [];
  }
}

/**
 * Get paths for a project (isolation boundaries)
 */
function getProjectPaths(projectId) {
  const projectDir = path.join(DATA_ROOT, projectId);
  
  return {
    root: projectDir,
    queue: path.join(projectDir, 'queue', 'items.json'),
    agents: path.join(projectDir, 'agents'),
    artifacts: path.join(projectDir, 'artifacts'),
    config: path.join(projectDir, 'config', 'meta.json'),
  };
}

/**
 * Delete project and all its data
 */
async function deleteProject(projectId) {
  const projectDir = path.join(DATA_ROOT, projectId);
  
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Update project config
 */
async function updateProject(projectId, updates) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  
  const updated = {
    ...project,
    ...updates,
    config: { ...project.config, ...updates.config },
    updatedAt: new Date().toISOString(),
  };
  
  const paths = getProjectPaths(projectId);
  await fs.writeFile(paths.config, JSON.stringify(updated, null, 2));
  
  return updated;
}

module.exports = {
  createProject,
  getProject,
  listProjects,
  deleteProject,
  updateProject,
  getProjectPaths,
  generateProjectId,
};
