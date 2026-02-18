#!/usr/bin/env node

/**
 * Orchestrator Server
 * 
 * HTTP API for queue management + WebSocket for real-time 3D scene updates.
 * Agent runtimes connect here to subscribe for work.
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { getAdapter } = require('./src/queue/redis-adapter');
const fileQueue = require('./src/queue');
const { getExecutor } = require('./src/executor');
const users = require('./src/users');
const { TicketManager } = require('./src/tickets');
const projects = require('./src/projects');
const { 
  setupWebSocket, 
  handleBoundariesAPI,
  initProjectBoundaries 
} = require('./src/scene-ws');

const PORT = process.env.PORT || 3000;
const USE_FILE_QUEUE = process.env.USE_FILE_QUEUE === '1' || process.env.NO_REDIS === '1';

let queue = null;
let executor = null;
let ticketManager = null;

/**
 * Simple router
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // JSON helper
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Body parser
  const getBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

  try {
    // ========== STATIC GUI ==========
    if (reqPath === '/' || reqPath === '/index.html') {
      const html = await fs.readFile(path.join(__dirname, 'public/index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    
    // 3D Scene
    if (reqPath === '/3d-scene' || reqPath === '/3d-scene.html') {
      const html = await fs.readFile(path.join(__dirname, 'public/3d-scene.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // ========== HEALTH ==========
    if (reqPath === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // ========== QUEUE ENDPOINTS ==========
    
    // List items
    if (reqPath === '/api/queue' && method === 'GET') {
      const status = url.searchParams.get('status');
      const items = await queue.list(status);
      return json({ items, count: items.length });
    }

    // Add item
    if (reqPath === '/api/queue' && method === 'POST') {
      const body = await getBody();
      const item = await queue.enqueue(body);
      return json({ item }, 201);
    }

    // Get single item
    if (reqPath.match(/^\/api\/queue\/[\w-]+$/) && method === 'GET') {
      const id = reqPath.split('/').pop();
      const item = await queue.get(id);
      if (!item) return json({ error: 'Not found' }, 404);
      return json({ item });
    }

    // Ready an item
    if (reqPath.match(/^\/api\/queue\/[\w-]+\/ready$/) && method === 'POST') {
      const id = reqPath.split('/')[3];
      const item = await queue.ready(id);
      return json({ item });
    }

    // Claim next work
    if (reqPath === '/api/queue/claim' && method === 'POST') {
      const body = await getBody();
      const agentId = body.agentId;
      if (!agentId) return json({ error: 'agentId required' }, 400);
      
      const item = await queue.claim(agentId);
      if (!item) return json({ item: null, message: 'No work available' });
      return json({ item });
    }

    // Complete work
    if (reqPath.match(/^\/api\/queue\/[\w-]+\/complete$/) && method === 'POST') {
      const id = reqPath.split('/')[3];
      const body = await getBody();
      const item = await queue.complete(id, body.artifacts || []);
      return json({ item });
    }

    // Queue stats
    if (reqPath === '/api/queue/stats' && method === 'GET') {
      const stats = await queue.stats();
      return json(stats);
    }

    // ========== PROJECT ENDPOINTS ==========
    
    // List projects
    if (reqPath === '/api/projects' && method === 'GET') {
      const status = url.searchParams.get('status');
      const projectList = await projects.list(status);
      return json({ projects: projectList, count: projectList.length });
    }
    
    // Create project
    if (reqPath === '/api/projects' && method === 'POST') {
      const body = await getBody();
      const project = await projects.create(body);
      return json({ project }, 201);
    }
    
    // Get project
    if (reqPath.match(/^\/api\/projects\/[\w-]+$/) && method === 'GET') {
      const id = reqPath.split('/').pop();
      const project = await projects.get(id);
      if (!project) return json({ error: 'Not found' }, 404);
      return json({ project });
    }
    
    // Update project
    if (reqPath.match(/^\/api\/projects\/[\w-]+$/) && method === 'PUT') {
      const id = reqPath.split('/').pop();
      const body = await getBody();
      const project = await projects.update(id, body);
      return json({ project });
    }
    
    // Add work item to project
    if (reqPath.match(/^\/api\/projects\/[\w-]+\/items$/) && method === 'POST') {
      const projectId = reqPath.split('/')[3];
      const body = await getBody();
      const result = await projects.addWorkItem(projectId, body);
      return json({ result }, 201);
    }
    
    // Ready all project items
    if (reqPath.match(/^\/api\/projects\/[\w-]+\/ready$/) && method === 'POST') {
      const projectId = reqPath.split('/')[3];
      const result = await projects.readyAll(projectId);
      return json({ result });
    }
    
    // Project boundaries (handled by scene-ws module)
    const handled = await handleBoundariesAPI(req, res);
    if (handled) return;

    // ========== AGENT ENDPOINTS ==========

    // Register heartbeat (stores in Redis for real-time status)
    if (reqPath === '/api/agents/heartbeat' && method === 'POST') {
      const body = await getBody();
      const agentData = {
        agentId: body.agentId,
        status: body.status || 'idle',
        openclaw: body.openclaw || false,
        lastSeen: new Date().toISOString(),
        host: req.headers['x-forwarded-for'] || req.connection.remoteAddress
      };
      
      // Store in Redis with TTL
      if (queue.redis) {
        await queue.redis.hSet('orchestrator:agents', body.agentId, JSON.stringify(agentData));
        await queue.redis.expire('orchestrator:agents', 300); // 5 min TTL
      }
      
      return json({ ok: true, received: agentData });
    }

    // List agents
    if (reqPath === '/api/agents' && method === 'GET') {
      let agents = [];
      
      // Get from Redis if available
      if (queue.redis) {
        const agentData = await queue.redis.hGetAll('orchestrator:agents');
        agents = Object.entries(agentData).map(([id, data]) => {
          try {
            return JSON.parse(data);
          } catch {
            return { agentId: id, status: 'unknown', raw: data };
          }
        });
      } else {
        // Fallback to queue adapter
        agents = await queue.getAgents();
      }
      
      return json({ agents, count: agents.length });
    }

    // Signal agent shutdown
    if (reqPath === '/api/agents/shutdown' && method === 'POST') {
      const body = await getBody();
      const agentId = body.agentId;
      
      if (!agentId) {
        return json({ error: 'agentId required' }, 400);
      }
      
      // Publish shutdown signal to Redis channel
      if (queue.redis) {
        await queue.redis.publish('orchestrator:shutdown', JSON.stringify({
          agentId: agentId,
          timestamp: new Date().toISOString()
        }));
      }
      
      return json({ 
        ok: true, 
        message: `Shutdown signal sent to ${agentId}`,
        note: 'Agent will shutdown within 5-10 seconds'
      });
    }

    // Scale agents (Docker-specific)
    if (reqPath === '/api/agents/scale' && method === 'POST') {
      const body = await getBody();
      const replicas = body.replicas || 2;
      
      // This would require Docker API access or docker-compose command
      // For now, return instructions
      return json({
        ok: true,
        message: 'To scale agents, run:',
        command: `docker-compose -f docker-compose.openclaw.yml up -d --scale agent=${replicas}`,
        requestedReplicas: replicas
      });
    }

    // ========== EXECUTOR ENDPOINTS ==========

    // Executor status
    if (reqPath === '/api/executor/status' && method === 'GET') {
      return json(executor.status());
    }

    // Execute item
    if (reqPath.match(/^\/api\/executor\/run\/[\w-]+$/) && method === 'POST') {
      const id = reqPath.split('/').pop();
      const body = await getBody();
      const result = await executor.executeItem(id);
      return json(result);
    }

    // Execute next N
    if (reqPath === '/api/executor/next' && method === 'POST') {
      const body = await getBody();
      const count = body.count || 1;
      const result = await executor.executeNext(count);
      return json(result);
    }

    // ========== USER ENDPOINTS ==========

    // Get or create user
    if (reqPath === '/api/users' && method === 'POST') {
      const body = await getBody();
      if (!body.userId) return json({ error: 'userId required' }, 400);
      const user = await users.getOrCreate(body.userId, body.metadata);
      return json({ user });
    }

    // List users
    if (reqPath === '/api/users' && method === 'GET') {
      const userList = await users.list();
      return json({ users: userList, count: userList.length });
    }

    // Get user stats
    if (reqPath.match(/^\/api\/users\/[\w-]+\/stats$/) && method === 'GET') {
      const userId = reqPath.split('/')[3];
      const stats = await users.getStats(userId);
      if (!stats) return json({ error: 'User not found' }, 404);
      return json(stats);
    }

    // Get user by ID
    if (reqPath.match(/^\/api\/users\/[\w-]+$/) && method === 'GET') {
      const userId = reqPath.split('/').pop();
      const user = await users.get(userId);
      if (!user) return json({ error: 'User not found' }, 404);
      return json({ user });
    }

    // Record task submitted
    if (reqPath.match(/^\/api\/users\/[\w-]+\/task-submitted$/) && method === 'POST') {
      const userId = reqPath.split('/')[3];
      const body = await getBody();
      const user = await users.recordTaskSubmitted(userId, body);
      return json({ user });
    }

    // Record task completed
    if (reqPath.match(/^\/api\/users\/[\w-]+\/task-completed$/) && method === 'POST') {
      const userId = reqPath.split('/')[3];
      const body = await getBody();
      const user = await users.recordTaskCompleted(userId, body);
      return json({ user });
    }

    // Record artifact review
    if (reqPath.match(/^\/api\/users\/[\w-]+\/artifact-review$/) && method === 'POST') {
      const userId = reqPath.split('/')[3];
      const body = await getBody();
      const user = await users.recordArtifactReview(userId, body.accepted, body.feedback);
      return json({ user });
    }

    // Leaderboard
    if (reqPath === '/api/leaderboard' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const leaderboard = await users.getLeaderboard(limit);
      return json({ leaderboard });
    }

    // ========== TICKET ENDPOINTS ==========

    // Create ticket (auto-triggers grooming)
    if (reqPath === '/api/tickets' && method === 'POST') {
      const body = await getBody();
      const ticket = await ticketManager.create(body);
      return json({ ticket }, 201);
    }

    // List tickets
    if (reqPath === '/api/tickets' && method === 'GET') {
      const filters = {
        status: url.searchParams.get('status'),
        priority: url.searchParams.get('priority'),
        groomingStatus: url.searchParams.get('groomingStatus')
      };
      const tickets = await ticketManager.list(filters);
      return json({ tickets, count: tickets.length });
    }

    // Get ticket
    if (reqPath.match(/^\/api\/tickets\/[\w-]+$/) && method === 'GET') {
      const id = reqPath.split('/').pop();
      const ticket = await ticketManager.get(id);
      if (!ticket) return json({ error: 'Ticket not found' }, 404);
      return json({ ticket });
    }

    // Update ticket
    if (reqPath.match(/^\/api\/tickets\/[\w-]+$/) && method === 'PUT') {
      const id = reqPath.split('/').pop();
      const body = await getBody();
      const ticket = await ticketManager.update(id, body);
      return json({ ticket });
    }

    // Get grooming status
    if (reqPath.match(/^\/api\/tickets\/[\w-]+\/grooming$/) && method === 'GET') {
      const id = reqPath.split('/')[3];
      const status = await ticketManager.getGroomingStatus(id);
      if (!status) return json({ error: 'Ticket not found' }, 404);
      return json(status);
    }

    // Trigger manual grooming
    if (reqPath.match(/^\/api\/tickets\/[\w-]+\/groom$/) && method === 'POST') {
      const id = reqPath.split('/')[3];
      const ticket = await ticketManager.get(id);
      if (!ticket) return json({ error: 'Ticket not found' }, 404);
      
      const session = await ticketManager.groomer.groomTicket(ticket);
      return json({ 
        message: 'Grooming started',
        ticketId: id,
        session: session?.sessionKey || null
      });
    }

    // Ticket stats
    if (reqPath === '/api/tickets/stats' && method === 'GET') {
      const stats = await ticketManager.getStats();
      return json(stats);
    }

    // 404
    return json({ error: 'Not found', path: reqPath }, 404);

  } catch (err) {
    console.error('Request error:', err);
    return json({ error: err.message }, 500);
  }
}

/**
 * Start server
 */
async function start() {
  console.log('🚀 Starting Orchestrator Server...\n');

  // Initialize queue adapter
  if (USE_FILE_QUEUE) {
    console.log('📁 Using file-based queue (NO_REDIS/USE_FILE_QUEUE mode)');
    queue = fileQueue;
  } else {
    queue = await getAdapter();
  }
  console.log('✅ Queue adapter ready');

  // Initialize executor
  executor = getExecutor({ mode: 'external' });
  console.log('✅ Executor ready');

  // Initialize ticket manager with grooming
  ticketManager = new TicketManager(queue, {
    grooming: {
      enabled: process.env.AUTO_GROOMING !== 'false',
      model: process.env.GROOMING_MODEL || 'gemini',
      timeoutSeconds: 300
    }
  });
  console.log('✅ Ticket manager ready (auto-grooming: ' + (process.env.AUTO_GROOMING !== 'false') + ')');
  
  // Initialize 3D scene project boundaries
  await initProjectBoundaries();
  console.log('✅ 3D Scene boundaries ready');

  // Create HTTP server
  const server = http.createServer(handleRequest);
  
  // Setup WebSocket server for 3D scene
  setupWebSocket(server);

  server.listen(PORT, () => {
    console.log(`\n🎯 Orchestrator listening on http://localhost:${PORT}`);
    console.log(`🎮 3D Scene available at http://localhost:${PORT}/3d-scene`);
    console.log(`
Endpoints:
  GET  /health              - Health check
  
  GET  /api/queue           - List all items
  POST /api/queue           - Add item { title, priority, ... }
  GET  /api/queue/:id       - Get item
  POST /api/queue/:id/ready - Mark ready (triggers notification)
  POST /api/queue/claim     - Claim work { agentId }
  POST /api/queue/:id/complete - Complete { artifacts }
  GET  /api/queue/stats     - Queue statistics
  
  GET  /api/projects        - List projects
  POST /api/projects        - Create project
  GET  /api/projects/:id    - Get project
  GET  /api/projects/:id/boundaries - Get project boundaries
  POST /api/projects/:id/boundaries - Set project boundaries
  
  POST /api/agents/heartbeat - Agent heartbeat { agentId, status }
  GET  /api/agents          - List agents
  POST /api/agents/shutdown - Shutdown agent { agentId }
  POST /api/agents/scale    - Scale agents { replicas }
  
  GET  /api/executor/status - Executor status
  POST /api/executor/run/:id - Execute item
  POST /api/executor/next   - Execute next N { count }
  
  GET  /api/tickets         - List tickets
  POST /api/tickets         - Create ticket (auto-grooms)
  GET  /api/tickets/:id     - Get ticket
  PUT  /api/tickets/:id     - Update ticket
  GET  /api/tickets/:id/grooming - Get grooming status
  POST /api/tickets/:id/groom - Trigger manual grooming
  GET  /api/tickets/stats   - Ticket statistics
  
WebSocket:
  ws://localhost:${PORT}/ws/agents - Agent connection for 3D scene
  Events: agent:connect, agent:move, agent:disconnect, agent:position
`);
  });
}

start().catch(console.error);
