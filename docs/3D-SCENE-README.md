# 🎮 3D Isometric Agent World

A real-time 3D isometric scene where agents can connect and control characters that walk around in project-defined gated areas.

![3D Scene Preview](docs/3d-scene-preview.png)

## Features

- **3D Isometric View**: Three.js-powered isometric rendering with camera controls
- **Multi-Agent Support**: Multiple agents can connect and move simultaneously
- **Project Boundaries**: Each project has configurable gated areas that constrain agent movement
- **Real-time Updates**: WebSocket-powered live position updates
- **Visual Distinction**: Agents are color-coded by project with floating labels
- **Interactive Controls**: Drag to rotate, scroll to zoom, click to see agent details

## Quick Start

### 1. Install Dependencies

```bash
cd agent-orchestrator
npm install
```

### 2. Start the Server

```bash
npm start
# or
node server.js
```

### 3. Open the 3D Scene

Navigate to: `http://localhost:3000/3d-scene`

### 4. Run the Demo (Optional)

```bash
node demo-3d-scene.js
```

This connects 5 demo agents that walk around randomly in their project zones.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                     3D Scene Viewer                      │
│              (public/3d-scene.html)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Project A  │  │  Project B  │  │  Project C  │     │
│  │  [Red Zone] │  │ [Blue Zone] │  │[Green Zone] │     │
│  │   👤 Alice  │  │   👤 Bob    │  │  👤 Charlie │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  • Three.js isometric camera                            │
│  • WebSocket client                                      │
│  • Boundary visualization                                │
└─────────────────────────────────────────────────────────┘
                           │
                           │ WebSocket
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Orchestrator Server                      │
│                   (server.js)                            │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Scene WebSocket Manager                │  │
│  │            (src/scene-ws.js)                     │  │
│  │  • Agent connection handling                     │  │
│  │  • Position broadcasting                         │  │
│  │  • Boundary enforcement                          │  │
│  └─────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Project Manager                        │  │
│  │        (src/projects/index.js)                   │  │
│  │  • Boundary storage per project                  │  │
│  │  • API: GET/POST /api/projects/:id/boundaries    │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### File Structure

```
agent-orchestrator/
├── public/
│   ├── index.html           # Main kanban UI
│   └── 3d-scene.html        # 🆕 3D isometric scene
├── src/
│   ├── scene-ws.js          # 🆕 WebSocket server for 3D scene
│   ├── scene-ws.test.js     # 🆕 Tests for scene WebSocket
│   └── projects/
│       └── index.js         # Project management (enhanced for boundaries)
├── server.js                # Main server (enhanced with WebSocket)
├── demo-3d-scene.js         # 🆕 Demo script with walking agents
└── package.json             # Added 'ws' dependency
```

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/agents');
```

### Events

#### Client → Server

**Agent Connect**
```javascript
{
  type: 'agent:connect',
  projectId: 'project-alpha',
  agentName: 'Alice',
  x: 10,  // optional
  z: -5   // optional
}
```

**Agent Move**
```javascript
{
  type: 'agent:move',
  agentId: 'agent-abc123',
  x: 25,
  z: -10
}
```

**Agent Disconnect**
```javascript
{
  type: 'agent:disconnect',
  agentId: 'agent-abc123'
}
```

#### Server → Client

**Initial State**
```javascript
{
  type: 'init',
  projects: [
    { id: 'project-1', bounds: { minX: -50, maxX: -15, minZ: -50, maxZ: -15 }, colorIndex: 0 }
  ],
  agents: [
    { id: 'agent-1', projectId: 'project-1', name: 'Bob', x: -30, z: -30 }
  ]
}
```

**Agent Connect Broadcast**
```javascript
{
  type: 'agent:connect',
  agentId: 'agent-abc123',
  projectId: 'project-alpha',
  agentName: 'Alice',
  x: 10,
  z: -5,
  bounds: { minX: -50, maxX: -15, minZ: -50, maxZ: -15 }
}
```

**Agent Move Broadcast**
```javascript
{
  type: 'agent:move',
  agentId: 'agent-abc123',
  x: 25,
  z: -10
}
```

**Agent Disconnect Broadcast**
```javascript
{
  type: 'agent:disconnect',
  agentId: 'agent-abc123'
}
```

## API Endpoints

### Project Boundaries

**Get Project Boundaries**
```bash
GET /api/projects/:id/boundaries
```

Response:
```json
{
  "projectId": "project-alpha",
  "bounds": {
    "minX": -50,
    "maxX": -15,
    "minZ": -50,
    "maxZ": -15
  },
  "colorIndex": 0
}
```

**Set Project Boundaries**
```bash
POST /api/projects/:id/boundaries
```

Body:
```json
{
  "bounds": {
    "minX": -30,
    "maxX": 30,
    "minZ": -30,
    "maxZ": 30
  }
}
```

## Configuration

### Default Project Boundaries

If no projects exist, the system creates three demo zones:

| Project | Color | Bounds (minX, maxX, minZ, maxZ) |
|---------|-------|--------------------------------|
| demo-project-1 | Red | -50, -15, -50, -15 |
| demo-project-2 | Blue | 15, 50, -50, -15 |
| demo-project-3 | Green | -20, 20, 10, 45 |

### Custom Boundaries

Boundaries are stored per-project and can be set via API:

```javascript
// Example: Create a project with custom boundaries
await fetch('/api/projects/my-project/boundaries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    bounds: {
      minX: -100,
      maxX: 100,
      minZ: -100,
      maxZ: 100
    }
  })
});
```

## Agent SDK Example

```javascript
class AgentCharacter {
  constructor(projectId, name) {
    this.ws = new WebSocket('ws://localhost:3000/ws/agents');
    this.projectId = projectId;
    this.name = name;
    this.agentId = null;
  }

  connect() {
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'agent:connect',
        projectId: this.projectId,
        agentName: this.name
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'agent:connect' && data.agentName === this.name) {
        this.agentId = data.agentId;
        console.log(`Connected as ${this.agentId}`);
      }
    };
  }

  moveTo(x, z) {
    if (!this.agentId) return;
    this.ws.send(JSON.stringify({
      type: 'agent:move',
      agentId: this.agentId,
      x, z
    }));
  }

  disconnect() {
    if (!this.agentId) return;
    this.ws.send(JSON.stringify({
      type: 'agent:disconnect',
      agentId: this.agentId
    }));
    this.ws.close();
  }
}

// Usage
const agent = new AgentCharacter('project-alpha', 'MyAgent');
agent.connect();

// Walk around
setInterval(() => {
  const x = Math.random() * 60 - 30;
  const z = Math.random() * 60 - 30;
  agent.moveTo(x, z);
}, 3000);
```

## Testing

```bash
# Run all tests
npm test

# Run only scene tests
npx vitest run src/scene-ws.test.js
```

## Browser Controls

| Action | Control |
|--------|---------|
| Rotate Camera | Drag with mouse |
| Zoom In/Out | Mouse wheel |
| Reset Camera | Click "Reset Camera" button |
| Add Test Agent | Click "Connect Test Agent" button |
| Trigger Random Walk | Click "Random Walk" button |

## Troubleshooting

### WebSocket Connection Failed

Check that the server is running and the WebSocket endpoint is accessible:
```bash
curl http://localhost:3000/health
```

### Agents Not Moving

Verify the agent is connected by checking the browser console for WebSocket messages. The agent must receive an `agent:connect` response with its `agentId` before it can move.

### Boundaries Not Visible

Ensure project boundaries are set via the API or the demo boundaries are initialized. Check the browser console for the `init` message containing project data.

## Future Enhancements

- [ ] Agent collision detection
- [ ] Pathfinding within boundaries
- [ ] Animated character models (GLTF)
- [ ] Agent-to-agent interactions
- [ ] Custom avatar uploads
- [ ] Persistent agent positions
- [ ] Mobile touch controls
- [ ] VR/AR support

## License

MIT
