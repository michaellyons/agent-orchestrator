---
name: agent-orchestrator
description: Distributed work queue for AI agents. Plan with Kimi, code with Codex. Manage tasks via kanban and spawn isolated agents for execution.
metadata:
  {
    "openclaw": { "emoji": "🎯" }
  }
---

# Agent Orchestrator

Distributed work queue with model-routing: Kimi K2.5 for planning/management, Codex for implementation.

## Overview

The orchestrator manages a kanban-style workflow:
- **📥 Inbox** → Raw tasks
- **📋 Ready** → Scoped & prioritized  
- **🚀 In Flight** → Active agent execution
- **✅ Done** → Completed with artifacts

## Quick Commands

```bash
# Add task to queue
cd ~/Developer/agent-orchestrator && node cli.js add "Build API client" --priority high

# Mark ready (triggers execution)
node cli.js ready <id>

# Execute with external agent (returns spawn config)
node cli.js exec <id>

# Check completion
node cli.js check <agentId>

# List all tasks
node cli.js list

# Web GUI (when server running)
open http://localhost:3000
```

## Server

```bash
# Start server
cd ~/Developer/agent-orchestrator && NO_REDIS=1 node server.js

# Or background
NO_REDIS=1 node server.js &

# Health check
curl http://localhost:3000/health
```

## Model Routing

| Phase | Model | Why |
|-------|-------|-----|
| Planning | Kimi K2.5 | Deep reasoning, architecture |
| Management | Kimi K2.5 | Queue decisions, prioritization |
| Coding | Codex (gpt-5.2-codex) | Fast, precise implementation |
| Review | Kimi K2.5 | Quality assurance |

## Spawning Codex for "In Flight" Tasks

When a work item enters "in_flight", spawn Codex in the prepared workspace:

```bash
# 1. Execute task (prepares workspace)
cd ~/Developer/agent-orchestrator
node cli.js exec <work-item-id>
# Returns: workspaceDir, artifactsDir, agentId

# 2. Spawn Codex in that workspace (PTY required!)
bash pty:true workdir:<workspaceDir> background:true command:"codex --yolo exec --full-auto 'Complete the task described in TASK.md. Place all output in the artifacts directory.'"

# 3. Check completion
node cli.js check <agentId>
```

## Work Item with Repo Output

```bash
# Create task that outputs to GitHub repo
curl -X POST http://localhost:3000/api/queue \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build React Dashboard",
    "description": "Create analytics dashboard with recharts",
    "priority": "high",
    "output": {
      "type": "repo",
      "name": "analytics-dashboard",
      "template": "react",
      "private": false
    }
  }'
```

## Full Auto-Execution Pattern

```bash
# 1. Add work item
ITEM=$(node cli.js add "Refactor auth module" --priority urgent | grep -o '[a-f0-9]\{16\}')

# 2. Ready it
node cli.js ready $ITEM

# 3. Execute (gets workspace)
EXEC=$(node cli.js exec $ITEM)
WORKSPACE=$(echo "$EXEC" | grep "Workspace:" | awk '{print $2}')
AGENT_ID=$(echo "$EXEC" | grep "Agent:" | awk '{print $2}')

# 4. Spawn Codex
bash pty:true workdir:$WORKSPACE background:true command:"codex --yolo exec 'Complete TASK.md requirements. Output to artifacts/.'"

# 5. Poll for completion
sleep 60 && node cli.js check $AGENT_ID
```

## Multi-Agent Parallel Execution

```bash
# Queue multiple items
for task in "API client" "Auth service" "UI components"; do
  node cli.js add "$task" --priority high
done

# Execute next N in parallel
node cli.js exec-next 3

# Each spawns separate Codex instance
```

## Web GUI Access

```bash
# Local
curl http://localhost:3000/

# Via ngrok
ngrok http 3000
# Returns: https://xxx.ngrok-free.app
```

## Environment

```bash
# Required for repo creation
export GITHUB_TOKEN="ghp_xxx"
export GITHUB_ORG="michaellyons"

# For file-queue mode (no Redis)
export NO_REDIS=1
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Status check |
| GET | /api/queue | List all items |
| POST | /api/queue | Add item |
| GET | /api/queue/:id | Get item |
| POST | /api/queue/:id/ready | Mark ready |
| POST | /api/queue/claim | Claim work |
| POST | /api/queue/:id/complete | Complete |
| GET | /api/executor/status | Executor state |
| POST | /api/executor/run/:id | Execute item |

## Integration with OpenClaw

When running inside OpenClaw, use `sessions_spawn` for agent execution:

```javascript
// From within OpenClaw session
const result = await sessions_spawn({
  task: "Complete the work item described in TASK.md",
  label: "worker-<agentId>",
  runTimeoutSeconds: 300,
  model: "opencode/claude-opus-4-5"  // or codex via coding-agent skill
});
```

## Rules

1. **Kimi plans, Codex codes** - Don't mix models within same phase
2. **Always use PTY for Codex** - Terminal apps need pseudo-terminal
3. **Check workspace boundaries** - Agents stay in their directories
4. **Poll don't block** - Use `cli.js check` or API polling
5. **Commit at milestones** - Push orchestrator changes to git
6. **GUI for overview** - Use web interface for kanban visibility

## Project Location

```
~/Developer/agent-orchestrator/
├── cli.js          # Command line interface
├── server.js       # HTTP API + WebSocket
├── src/
│   ├── queue/      # Queue management
│   ├── executor/   # Agent spawning
│   ├── repos/      # GitHub provider
│   └── ui/         # React kanban (future)
├── public/         # Web GUI
└── data/           # Workspaces & artifacts
```
