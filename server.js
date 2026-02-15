#!/usr/bin/env node

/**
 * Orchestrator Server
 * 
 * HTTP API for queue management + WebSocket for real-time updates.
 * Agent runtimes connect here to subscribe for work.
 */

const http = require('http');
const { getAdapter } = require('./src/queue/redis-adapter');
const { getExecutor } = require('./src/executor');
const users = require('./src/users');

const PORT = process.env.PORT || 3000;

let queue = null;
let executor = null;

/**
 * Simple router
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
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
    // ========== HEALTH ==========
    if (path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // ========== QUEUE ENDPOINTS ==========
    
    // List items
    if (path === '/api/queue' && method === 'GET') {
      const status = url.searchParams.get('status');
      const items = await queue.list(status);
      return json({ items, count: items.length });
    }

    // Add item
    if (path === '/api/queue' && method === 'POST') {
      const body = await getBody();
      const item = await queue.enqueue(body);
      return json({ item }, 201);
    }

    // Get single item
    if (path.match(/^\/api\/queue\/[\w-]+$/) && method === 'GET') {
      const id = path.split('/').pop();
      const item = await queue.get(id);
      if (!item) return json({ error: 'Not found' }, 404);
      return json({ item });
    }

    // Ready an item
    if (path.match(/^\/api\/queue\/[\w-]+\/ready$/) && method === 'POST') {
      const id = path.split('/')[3];
      const item = await queue.ready(id);
      return json({ item });
    }

    // Claim next work
    if (path === '/api/queue/claim' && method === 'POST') {
      const body = await getBody();
      const agentId = body.agentId;
      if (!agentId) return json({ error: 'agentId required' }, 400);
      
      const item = await queue.claim(agentId);
      if (!item) return json({ item: null, message: 'No work available' });
      return json({ item });
    }

    // Complete work
    if (path.match(/^\/api\/queue\/[\w-]+\/complete$/) && method === 'POST') {
      const id = path.split('/')[3];
      const body = await getBody();
      const item = await queue.complete(id, body.artifacts || []);
      return json({ item });
    }

    // Queue stats
    if (path === '/api/queue/stats' && method === 'GET') {
      const stats = await queue.stats();
      return json(stats);
    }

    // ========== AGENT ENDPOINTS ==========

    // Register heartbeat
    if (path === '/api/agents/heartbeat' && method === 'POST') {
      const body = await getBody();
      await queue.heartbeat(body.agentId, body.status || 'idle');
      return json({ ok: true });
    }

    // List agents
    if (path === '/api/agents' && method === 'GET') {
      const agents = await queue.getAgents();
      return json({ agents });
    }

    // ========== EXECUTOR ENDPOINTS ==========

    // Executor status
    if (path === '/api/executor/status' && method === 'GET') {
      return json(executor.status());
    }

    // Execute item
    if (path.match(/^\/api\/executor\/run\/[\w-]+$/) && method === 'POST') {
      const id = path.split('/').pop();
      const body = await getBody();
      const result = await executor.executeItem(id);
      return json(result);
    }

    // Execute next N
    if (path === '/api/executor/next' && method === 'POST') {
      const body = await getBody();
      const count = body.count || 1;
      const result = await executor.executeNext(count);
      return json(result);
    }

    // ========== USER ENDPOINTS ==========

    // Get or create user
    if (path === '/api/users' && method === 'POST') {
      const body = await getBody();
      if (!body.userId) return json({ error: 'userId required' }, 400);
      const user = await users.getOrCreate(body.userId, body.metadata);
      return json({ user });
    }

    // List users
    if (path === '/api/users' && method === 'GET') {
      const userList = await users.list();
      return json({ users: userList, count: userList.length });
    }

    // Get user stats
    if (path.match(/^\/api\/users\/[\w-]+\/stats$/) && method === 'GET') {
      const userId = path.split('/')[3];
      const stats = await users.getStats(userId);
      if (!stats) return json({ error: 'User not found' }, 404);
      return json(stats);
    }

    // Get user by ID
    if (path.match(/^\/api\/users\/[\w-]+$/) && method === 'GET') {
      const userId = path.split('/').pop();
      const user = await users.get(userId);
      if (!user) return json({ error: 'User not found' }, 404);
      return json({ user });
    }

    // Record task submitted
    if (path.match(/^\/api\/users\/[\w-]+\/task-submitted$/) && method === 'POST') {
      const userId = path.split('/')[3];
      const body = await getBody();
      const user = await users.recordTaskSubmitted(userId, body);
      return json({ user });
    }

    // Record task completed
    if (path.match(/^\/api\/users\/[\w-]+\/task-completed$/) && method === 'POST') {
      const userId = path.split('/')[3];
      const body = await getBody();
      const user = await users.recordTaskCompleted(userId, body);
      return json({ user });
    }

    // Record artifact review
    if (path.match(/^\/api\/users\/[\w-]+\/artifact-review$/) && method === 'POST') {
      const userId = path.split('/')[3];
      const body = await getBody();
      const user = await users.recordArtifactReview(userId, body.accepted, body.feedback);
      return json({ user });
    }

    // Leaderboard
    if (path === '/api/leaderboard' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const leaderboard = await users.getLeaderboard(limit);
      return json({ leaderboard });
    }

    // 404
    return json({ error: 'Not found', path }, 404);

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
  queue = await getAdapter();
  console.log('✅ Queue adapter ready');

  // Initialize executor
  executor = getExecutor({ mode: 'external' });
  console.log('✅ Executor ready');

  // Create HTTP server
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`\n🎯 Orchestrator listening on http://localhost:${PORT}`);
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
  POST /api/agents/heartbeat - Agent heartbeat { agentId, status }
  GET  /api/agents          - List agents
  GET  /api/executor/status - Executor status
  POST /api/executor/run/:id - Execute item
  POST /api/executor/next   - Execute next N { count }
`);
  });
}

start().catch(console.error);
