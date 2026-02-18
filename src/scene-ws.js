/**
 * 3D Scene WebSocket Server Extension
 * 
 * Handles agent connections and movement in the 3D isometric world.
 * This module extends the main HTTP server with WebSocket support.
 */

const WebSocket = require('ws');
const projects = require('./src/projects');

// Active agent connections
const connectedAgents = new Map();
const projectBoundaries = new Map();

// Project colors for agent assignment
const projectColors = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 
  0x9b59b6, 0x1abc9c, 0xe91e63, 0x00bcd4
];

/**
 * Initialize project boundaries
 */
async function initProjectBoundaries() {
  // Load existing projects and set default boundaries
  const projectList = await projects.list();
  
  for (let i = 0; i < projectList.length; i++) {
    const p = projectList[i];
    if (!projectBoundaries.has(p.id)) {
      // Create a default boundary based on project index
      const angle = (i / Math.max(1, projectList.length)) * Math.PI * 2;
      const radius = 40;
      const centerX = Math.cos(angle) * radius;
      const centerZ = Math.sin(angle) * radius;
      
      setProjectBoundary(p.id, {
        minX: centerX - 20,
        maxX: centerX + 20,
        minZ: centerZ - 20,
        maxZ: centerZ + 20
      });
    }
  }
  
  // If no projects, create demo boundaries
  if (projectBoundaries.size === 0) {
    setProjectBoundary('demo-project-1', {
      minX: -50, maxX: -15,
      minZ: -50, maxZ: -15
    });
    
    setProjectBoundary('demo-project-2', {
      minX: 15, maxX: 50,
      minZ: -50, maxZ: -15
    });
    
    setProjectBoundary('demo-project-3', {
      minX: -20, maxX: 20,
      minZ: 10, maxZ: 45
    });
  }
}

/**
 * Set boundary for a project
 */
function setProjectBoundary(projectId, bounds) {
  projectBoundaries.set(projectId, {
    id: projectId,
    bounds,
    colorIndex: projectBoundaries.size % projectColors.length
  });
  return projectBoundaries.get(projectId);
}

/**
 * Get boundary for a project
 */
function getProjectBoundary(projectId) {
  return projectBoundaries.get(projectId);
}

/**
 * Clamp position to project boundaries
 */
function clampToBoundary(projectId, x, z) {
  const project = projectBoundaries.get(projectId);
  if (!project) return { x, z };
  
  const { minX, maxX, minZ, maxZ } = project.bounds;
  return {
    x: Math.max(minX + 2, Math.min(maxX - 2, x)),
    z: Math.max(minZ + 2, Math.min(maxZ - 2, z))
  };
}

/**
 * Get random position within project boundary
 */
function getRandomPosition(projectId) {
  const project = projectBoundaries.get(projectId);
  if (!project) return { x: 0, z: 0 };
  
  const { minX, maxX, minZ, maxZ } = project.bounds;
  return {
    x: minX + 2 + Math.random() * (maxX - minX - 4),
    z: minZ + 2 + Math.random() * (maxZ - minZ - 4)
  };
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(wss, message, excludeWs = null) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Setup WebSocket server
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ws/agents'
  });
  
  console.log('✅ WebSocket server ready on /ws/agents');
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 New agent connection from', req.socket.remoteAddress);
    
    // Send initial state
    const initMessage = {
      type: 'init',
      projects: Array.from(projectBoundaries.values()).map(p => ({
        id: p.id,
        bounds: p.bounds,
        colorIndex: p.colorIndex
      })),
      agents: Array.from(connectedAgents.values()).map(a => ({
        id: a.id,
        projectId: a.projectId,
        name: a.name,
        x: a.x,
        z: a.z
      }))
    };
    ws.send(JSON.stringify(initMessage));
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        handleMessage(ws, wss, message);
      } catch (err) {
        console.error('WebSocket message error:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });
    
    ws.on('close', () => {
      // Find and remove disconnected agent
      for (const [id, agent] of connectedAgents) {
        if (agent.ws === ws) {
          connectedAgents.delete(id);
          broadcast(wss, {
            type: 'agent:disconnect',
            agentId: id
          });
          console.log(`👋 Agent ${id} disconnected`);
          break;
        }
      }
    });
    
    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });
  
  return wss;
}

/**
 * Handle WebSocket messages
 */
function handleMessage(ws, wss, message) {
  const { type, ...data } = message;
  
  switch (type) {
    case 'agent:connect':
      handleAgentConnect(ws, wss, data);
      break;
      
    case 'agent:disconnect':
      handleAgentDisconnect(ws, wss, data);
      break;
      
    case 'agent:move':
      handleAgentMove(ws, wss, data);
      break;
      
    case 'agent:position':
      handleAgentPosition(ws, wss, data);
      break;
      
    case 'project:boundary':
      handleProjectBoundary(ws, wss, data);
      break;
      
    default:
      console.log('Unknown message type:', type);
  }
}

/**
 * Handle agent connect
 */
function handleAgentConnect(ws, wss, data) {
  const { projectId, agentName, x, z } = data;
  
  // Create project boundary if doesn't exist
  if (!projectBoundaries.has(projectId)) {
    setProjectBoundary(projectId, {
      minX: -30, maxX: 30,
      minZ: -30, maxZ: 30
    });
  }
  
  // Generate agent ID
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  
  // Get position within boundaries
  const pos = x !== undefined && z !== undefined 
    ? clampToBoundary(projectId, x, z)
    : getRandomPosition(projectId);
  
  const agent = {
    id: agentId,
    projectId,
    name: agentName || agentId,
    x: pos.x,
    z: pos.z,
    ws
  };
  
  connectedAgents.set(agentId, agent);
  
  // Broadcast to all clients
  broadcast(wss, {
    type: 'agent:connect',
    agentId,
    projectId,
    agentName: agent.name,
    x: pos.x,
    z: pos.z,
    bounds: projectBoundaries.get(projectId).bounds
  });
  
  console.log(`🤖 Agent ${agentId} connected to project ${projectId}`);
}

/**
 * Handle agent disconnect
 */
function handleAgentDisconnect(ws, wss, data) {
  const { agentId } = data;
  
  if (connectedAgents.has(agentId)) {
    connectedAgents.delete(agentId);
    broadcast(wss, {
      type: 'agent:disconnect',
      agentId
    });
    console.log(`👋 Agent ${agentId} disconnected`);
  }
}

/**
 * Handle agent move request
 */
function handleAgentMove(ws, wss, data) {
  const { agentId, x, z } = data;
  
  const agent = connectedAgents.get(agentId);
  if (!agent) {
    ws.send(JSON.stringify({ type: 'error', message: 'Agent not found' }));
    return;
  }
  
  // Clamp to boundaries
  const pos = clampToBoundary(agent.projectId, x, z);
  agent.x = pos.x;
  agent.z = pos.z;
  
  // Broadcast new position
  broadcast(wss, {
    type: 'agent:move',
    agentId,
    x: pos.x,
    z: pos.z
  });
}

/**
 * Handle agent position update (broadcast only)
 */
function handleAgentPosition(ws, wss, data) {
  const { agentId, x, z } = data;
  
  const agent = connectedAgents.get(agentId);
  if (!agent) return;
  
  // Update position
  const pos = clampToBoundary(agent.projectId, x, z);
  agent.x = pos.x;
  agent.z = pos.z;
  
  // Broadcast to other clients
  broadcast(wss, {
    type: 'agent:position',
    agentId,
    x: pos.x,
    z: pos.z
  }, ws);
}

/**
 * Handle project boundary update
 */
function handleProjectBoundary(ws, wss, data) {
  const { projectId, bounds } = data;
  
  setProjectBoundary(projectId, bounds);
  
  broadcast(wss, {
    type: 'project:boundary',
    projectId,
    bounds
  });
  
  console.log(`📦 Project ${projectId} boundary updated`);
}

/**
 * API route handler for project boundaries
 */
async function handleBoundariesAPI(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const match = url.pathname.match(/^\/api\/projects\/([^\/]+)\/boundaries$/);
  
  if (!match) return false;
  
  const projectId = match[1];
  const method = req.method;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  
  try {
    if (method === 'GET') {
      const boundary = getProjectBoundary(projectId);
      if (!boundary) {
        return json({ error: 'Project boundary not found' }, 404);
      }
      return json({ 
        projectId,
        bounds: boundary.bounds,
        colorIndex: boundary.colorIndex
      });
    }
    
    if (method === 'POST' || method === 'PUT') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.bounds || typeof data.bounds !== 'object') {
            return json({ error: 'bounds object required' }, 400);
          }
          
          const { minX, maxX, minZ, maxZ } = data.bounds;
          if ([minX, maxX, minZ, maxZ].some(v => typeof v !== 'number')) {
            return json({ error: 'bounds must have numeric minX, maxX, minZ, maxZ' }, 400);
          }
          
          setProjectBoundary(projectId, data.bounds);
          return json({ 
            projectId,
            bounds: data.bounds,
            message: 'Boundary updated'
          });
        } catch (err) {
          return json({ error: err.message }, 400);
        }
      });
      return true;
    }
    
    return json({ error: 'Method not allowed' }, 405);
    
  } catch (err) {
    console.error('Boundaries API error:', err);
    return json({ error: err.message }, 500);
  }
}

/**
 * Get all connected agents
 */
function getConnectedAgents() {
  return Array.from(connectedAgents.values());
}

/**
 * Get all project boundaries
 */
function getAllBoundaries() {
  return Array.from(projectBoundaries.values());
}

module.exports = {
  setupWebSocket,
  handleBoundariesAPI,
  initProjectBoundaries,
  setProjectBoundary,
  getProjectBoundary,
  getAllBoundaries,
  getConnectedAgents,
  clampToBoundary,
  getRandomPosition
};
