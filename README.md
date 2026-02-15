# Agent Orchestrator

A distributed work queue and orchestration layer for AI agents. Feed ideas in, watch them flow through a kanban-style lifecycle, and spin up isolated agents for parallel execution.

## Vision

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   INBOX     │ →  │  PLANNING   │ →  │  IN FLIGHT  │ →  │    DONE     │
│             │    │             │    │             │    │             │
│  Raw ideas  │    │  Scoped &   │    │  Agent(s)   │    │  Artifacts  │
│  from team  │    │  estimated  │    │  working    │    │  delivered  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## Core Concepts

### 1. **Work Items**
Atomic units of work with:
- Title, description, acceptance criteria
- Priority & estimated complexity
- Status (kanban column)
- Assigned agent session(s)
- Artifacts produced

### 2. **Queue**
FIFO with priority override. Work items enter as ideas, get triaged/scoped, then dispatched to agents.

### 3. **Agent Sessions**
Isolated OpenClaw sessions (`sessions_spawn`) with:
- Dedicated workspace/data directory
- Scoped context (only sees its assigned work)
- Reports progress back to orchestrator

### 4. **Kanban Board**
Real-time visualization of:
- Work item flow through stages
- Agent activity & progress
- Blockers & dependencies

## Tech Stack

- **Backend:** Node.js + SST (AWS Lambda, DynamoDB, SQS)
- **Queue:** SQS or simple DynamoDB stream
- **Frontend:** React (kanban UI)
- **Agent Runtime:** OpenClaw sessions_spawn API

## Project Structure

```
agent-orchestrator/
├── docs/           # Architecture, ADRs
├── src/
│   ├── queue/      # Queue management
│   ├── agents/     # Agent orchestration & session management
│   ├── api/        # REST/WebSocket API
│   └── ui/         # React kanban frontend
└── data/           # Local dev data / isolated agent workspaces
```

## Phase 1: Local Prototype

1. Simple JSON-file queue (no AWS yet)
2. CLI to add/list/claim work items
3. Basic agent spawning with isolated data dirs
4. Minimal React kanban board

## Getting Started

```bash
# TBD - scaffolding in progress
```

---

*Built for Clawb infrastructure experiments.*
