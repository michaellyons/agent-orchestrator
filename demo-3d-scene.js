#!/usr/bin/env node

/**
 * 3D Scene Demo
 * 
 * Demonstrates the 3D isometric scene with multiple agents
 * walking around in project-defined boundaries.
 * 
 * Usage: node demo-3d-scene.js
 */

const http = require('http');
const WebSocket = require('ws');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws/agents';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(colors[color] || '', ...args, colors.reset);
}

class DemoAgent {
  constructor(projectId, name, color) {
    this.projectId = projectId;
    this.name = name;
    this.color = color;
    this.ws = null;
    this.agentId = null;
    this.position = { x: 0, z: 0 };
    this.targetPosition = null;
    this.moving = false;
    this.walkInterval = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      
      this.ws.on('open', () => {
        log('green', `🔌 ${this.name} connected`);
        
        // Join a project
        this.ws.send(JSON.stringify({
          type: 'agent:connect',
          projectId: this.projectId,
          agentName: this.name
        }));
        
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        this.handleMessage(message);
      });
      
      this.ws.on('error', (err) => {
        log('red', `❌ ${this.name} error:`, err.message);
        reject(err);
      });
      
      this.ws.on('close', () => {
        log('yellow', `👋 ${this.name} disconnected`);
        this.stopWalking();
      });
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'agent:connect':
        if (message.agentName === this.name) {
          this.agentId = message.agentId;
          this.position = { x: message.x, z: message.z };
          log('cyan', `🤖 ${this.name} joined ${this.projectId} at (${message.x.toFixed(1)}, ${message.z.toFixed(1)})`);
          
          // Start random walking
          this.startWalking();
        }
        break;
        
      case 'agent:move':
        if (message.agentId === this.agentId) {
          this.position = { x: message.x, z: message.z };
        }
        break;
    }
  }

  startWalking() {
    // Walk to a random position every 3-6 seconds
    this.walkInterval = setInterval(() => {
      if (!this.moving) {
        this.walkToRandomPosition();
      }
    }, 3000 + Math.random() * 3000);
    
    // Initial walk
    setTimeout(() => this.walkToRandomPosition(), 1000);
  }

  stopWalking() {
    if (this.walkInterval) {
      clearInterval(this.walkInterval);
      this.walkInterval = null;
    }
  }

  walkToRandomPosition() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Generate random offset (-15 to +15)
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetZ = (Math.random() - 0.5) * 30;
    
    const targetX = this.position.x + offsetX;
    const targetZ = this.position.z + offsetZ;
    
    log('blue', `🚶 ${this.name} walking to (${targetX.toFixed(1)}, ${targetZ.toFixed(1)})`);
    
    this.ws.send(JSON.stringify({
      type: 'agent:move',
      agentId: this.agentId,
      x: targetX,
      z: targetZ
    }));
    
    this.moving = true;
    
    // Clear moving flag after estimated arrival (simplified)
    setTimeout(() => {
      this.moving = false;
    }, 2000);
  }

  disconnect() {
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type: 'agent:disconnect',
        agentId: this.agentId
      }));
      this.ws.close();
    }
  }
}

async function checkServer() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${SERVER_URL}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.status === 'ok') {
            resolve(true);
          } else {
            reject(new Error('Server not healthy'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error(`Cannot connect to server at ${SERVER_URL}: ${err.message}`));
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

async function runDemo() {
  console.log('\n🎮 3D Isometric Scene Demo\n');
  console.log('===========================\n');
  
  // Check server is running
  try {
    await checkServer();
    log('green', '✅ Server is running');
  } catch (err) {
    log('red', '❌', err.message);
    console.log('\nPlease start the server first:');
    console.log('  npm start\n');
    process.exit(1);
  }
  
  console.log('\n📡 Connecting agents to WebSocket...\n');
  
  // Create demo agents in different projects
  const agents = [
    new DemoAgent('demo-project-1', 'Alice', 'red'),
    new DemoAgent('demo-project-1', 'Bob', 'red'),
    new DemoAgent('demo-project-2', 'Charlie', 'blue'),
    new DemoAgent('demo-project-2', 'Diana', 'blue'),
    new DemoAgent('demo-project-3', 'Eve', 'green'),
  ];
  
  // Connect all agents
  try {
    await Promise.all(agents.map(agent => agent.connect()));
    log('green', '\n✅ All agents connected\n');
  } catch (err) {
    log('red', '❌ Failed to connect agents:', err.message);
    process.exit(1);
  }
  
  // Demo instructions
  console.log('===========================\n');
  console.log('🌐 Open the 3D scene in your browser:');
  console.log(`   ${SERVER_URL}/3d-scene\n`);
  console.log('Watch the agents walk around in their project zones!\n');
  console.log('Press Ctrl+C to stop the demo\n');
  
  // Handle cleanup
  process.on('SIGINT', () => {
    console.log('\n\n👋 Disconnecting agents...\n');
    agents.forEach(agent => agent.disconnect());
    setTimeout(() => process.exit(0), 500);
  });
  
  // Keep running
  setInterval(() => {
    // Periodic status update
    const active = agents.filter(a => a.ws?.readyState === WebSocket.OPEN).length;
    process.stdout.write(`\r${colors.cyan}👥 Active agents: ${active}/${agents.length}${colors.reset}  `);
  }, 5000);
}

// Run if called directly
if (require.main === module) {
  runDemo().catch(err => {
    console.error('Demo error:', err);
    process.exit(1);
  });
}

module.exports = { DemoAgent, runDemo };
