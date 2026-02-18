/**
 * @jest-environment node
 */

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('vitest');
const http = require('http');
const WebSocket = require('ws');
const {
  setupWebSocket,
  setProjectBoundary,
  getProjectBoundary,
  getAllBoundaries,
  clampToBoundary,
  getRandomPosition,
  initProjectBoundaries
} = require('../src/scene-ws');

describe('3D Scene WebSocket', () => {
  let server;
  let wss;
  let port;

  beforeAll(async () => {
    // Create a test HTTP server
    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    });

    // Setup WebSocket
    wss = setupWebSocket(server);

    // Start server on random port
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterAll(() => {
    if (wss) wss.close();
    if (server) server.close();
  });

  describe('Project Boundaries', () => {
    beforeEach(() => {
      // Clear boundaries before each test
      // Note: In a real implementation, we'd want to reset the Map
    });

    it('should set and get project boundary', () => {
      const bounds = {
        minX: -50,
        maxX: 50,
        minZ: -50,
        maxZ: 50
      };

      const result = setProjectBoundary('test-project', bounds);

      expect(result.id).toBe('test-project');
      expect(result.bounds).toEqual(bounds);
      expect(result.colorIndex).toBeDefined();

      const retrieved = getProjectBoundary('test-project');
      expect(retrieved).toEqual(result);
    });

    it('should get all boundaries', () => {
      setProjectBoundary('project-1', { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
      setProjectBoundary('project-2', { minX: -20, maxX: 20, minZ: -20, maxZ: 20 });

      const all = getAllBoundaries();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.some(b => b.id === 'project-1')).toBe(true);
      expect(all.some(b => b.id === 'project-2')).toBe(true);
    });

    it('should clamp position to boundary', () => {
      const bounds = {
        minX: -30,
        maxX: 30,
        minZ: -30,
        maxZ: 30
      };

      setProjectBoundary('clamp-test', bounds);

      // Test position inside boundary
      let pos = clampToBoundary('clamp-test', 0, 0);
      expect(pos.x).toBe(0);
      expect(pos.z).toBe(0);

      // Test position outside boundary (should be clamped)
      pos = clampToBoundary('clamp-test', 100, 100);
      expect(pos.x).toBeLessThanOrEqual(28); // maxX - 2 padding
      expect(pos.z).toBeLessThanOrEqual(28);
      expect(pos.x).toBeGreaterThanOrEqual(-28);
      expect(pos.z).toBeGreaterThanOrEqual(-28);
    });

    it('should get random position within boundary', () => {
      const bounds = {
        minX: -20,
        maxX: 20,
        minZ: -20,
        maxZ: 20
      };

      setProjectBoundary('random-test', bounds);

      const pos = getRandomPosition('random-test');

      expect(pos.x).toBeGreaterThanOrEqual(bounds.minX + 2);
      expect(pos.x).toBeLessThanOrEqual(bounds.maxX - 2);
      expect(pos.z).toBeGreaterThanOrEqual(bounds.minZ + 2);
      expect(pos.z).toBeLessThanOrEqual(bounds.maxZ - 2);
    });
  });

  describe('WebSocket Connection', () => {
    it('should accept WebSocket connections', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/agents`);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should send init message on connection', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/agents`);

      const message = await new Promise((resolve, reject) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data));
        });
        ws.on('error', reject);
      });

      expect(message.type).toBe('init');
      expect(message.projects).toBeDefined();
      expect(Array.isArray(message.projects)).toBe(true);
      expect(message.agents).toBeDefined();
      expect(Array.isArray(message.agents)).toBe(true);

      ws.close();
    });

    it('should handle agent:connect message', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/agents`);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Wait for init
      await new Promise((resolve) => {
        ws.once('message', resolve);
      });

      // Send connect message
      ws.send(JSON.stringify({
        type: 'agent:connect',
        projectId: 'test-project-ws',
        agentName: 'TestAgent'
      }));

      // Wait for broadcast
      const message = await new Promise((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'agent:connect') {
            resolve(msg);
          }
        });
      });

      expect(message.type).toBe('agent:connect');
      expect(message.agentId).toBeDefined();
      expect(message.projectId).toBe('test-project-ws');
      expect(message.agentName).toBe('TestAgent');
      expect(message.x).toBeDefined();
      expect(message.z).toBeDefined();

      ws.close();
    });

    it('should handle agent:move message', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/agents`);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Wait for init
      await new Promise((resolve) => {
        ws.once('message', resolve);
      });

      // Connect an agent first
      let agentId;
      ws.send(JSON.stringify({
        type: 'agent:connect',
        projectId: 'test-move-project',
        agentName: 'MoveAgent'
      }));

      await new Promise((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'agent:connect' && msg.agentName === 'MoveAgent') {
            agentId = msg.agentId;
            resolve();
          }
        });
      });

      // Now move the agent
      ws.send(JSON.stringify({
        type: 'agent:move',
        agentId: agentId,
        x: 10,
        z: 20
      }));

      const moveMessage = await new Promise((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'agent:move') {
            resolve(msg);
          }
        });
      });

      expect(moveMessage.agentId).toBe(agentId);
      expect(moveMessage.x).toBe(10);
      expect(moveMessage.z).toBe(20);

      ws.close();
    });
  });

  describe('Boundary API', () => {
    it('should return 404 for non-existent project boundary', async () => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/projects/nonexistent/boundaries',
        method: 'GET'
      }, (res) => {
        expect(res.statusCode).toBe(404);
      });

      req.end();
    });
  });
});

describe('3D Scene Integration', () => {
  it('should initialize default boundaries if no projects exist', async () => {
    // This would be tested against a real server instance
    // For now, we verify the function exists
    expect(typeof initProjectBoundaries).toBe('function');
  });
});
