# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                               │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐                │
│  │   Queue    │   │  Dispatch  │   │  Monitor   │                │
│  │  Manager   │ → │   Engine   │ → │  & Report  │                │
│  └────────────┘   └────────────┘   └────────────┘                │
└──────────────────────────────────────────────────────────────────┘
        ↑                   │                    ↑
        │                   ↓                    │
   ┌────────┐      ┌───────────────┐      ┌──────────┐
   │  API   │      │ Agent Pool    │      │  Events  │
   │        │      │ ┌───┐ ┌───┐   │      │  Stream  │
   │ REST + │      │ │ A │ │ B │   │      │          │
   │   WS   │      │ └───┘ └───┘   │      │ Progress │
   └────────┘      │ ┌───┐ ┌───┐   │      │ Updates  │
        ↑          │ │ C │ │...│   │      └──────────┘
        │          │ └───┘ └───┘   │            ↓
   ┌────────┐      └───────────────┘      ┌──────────┐
   │ Kanban │                             │  Kanban  │
   │   UI   │ ←───────────────────────────│   UI     │
   └────────┘                             └──────────┘
```

## Data Model

### WorkItem

```typescript
interface WorkItem {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  
  // Lifecycle
  status: 'inbox' | 'planning' | 'ready' | 'in_flight' | 'review' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  complexity: 'xs' | 's' | 'm' | 'l' | 'xl';
  
  // Assignment
  assignedAgentId?: string;
  assignedSessionKey?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  
  // Artifacts
  artifacts: Artifact[];
  
  // Dependencies
  blockedBy: string[];  // WorkItem IDs
  blocks: string[];     // WorkItem IDs
}

interface Artifact {
  id: string;
  type: 'file' | 'pr' | 'document' | 'link';
  path: string;
  description: string;
  createdAt: string;
}
```

### AgentSession

```typescript
interface AgentSession {
  id: string;
  sessionKey: string;
  status: 'idle' | 'working' | 'blocked' | 'completed' | 'failed';
  
  // Isolation
  workspaceDir: string;
  dataDir: string;
  
  // Current work
  currentWorkItemId?: string;
  
  // Metrics
  startedAt: string;
  lastActivityAt: string;
  tokensUsed: number;
}
```

## Queue Operations

### Enqueue (Add Work)
1. Validate work item structure
2. Assign ID, timestamps
3. Set status = 'inbox'
4. Persist to queue store
5. Emit 'work:added' event

### Dequeue (Claim Work)
1. Find highest priority 'ready' item
2. Atomic status update → 'in_flight'
3. Assign to requesting agent
4. Return work item + context

### Complete
1. Validate artifacts meet acceptance criteria
2. Status → 'review' or 'done'
3. Release agent assignment
4. Emit 'work:completed' event

## Agent Lifecycle

```
┌─────────┐   spawn   ┌─────────┐   assign   ┌─────────┐
│  IDLE   │ ───────→  │  READY  │ ────────→  │ WORKING │
└─────────┘           └─────────┘            └─────────┘
                                                  │
                           ┌──────────────────────┤
                           ↓                      ↓
                      ┌─────────┐           ┌──────────┐
                      │ BLOCKED │           │ COMPLETE │
                      └─────────┘           └──────────┘
```

## Event Stream

WebSocket events for real-time UI updates:

- `work:added` - New item in queue
- `work:status_changed` - Item moved columns
- `work:assigned` - Agent picked up work
- `work:progress` - Intermediate update from agent
- `work:completed` - Work finished
- `agent:spawned` - New agent session created
- `agent:status_changed` - Agent state change

## Isolation Strategy

Each agent session gets:
1. **Workspace:** `data/agents/{sessionId}/workspace/`
2. **Context file:** Scoped AGENTS.md with only relevant info
3. **Artifact output:** `data/agents/{sessionId}/artifacts/`

Agents cannot see:
- Other agents' workspaces
- Queue state (only their assigned item)
- Other work items in progress

## Phase 1 Implementation

Keep it simple:
- `queue.json` file as queue store
- Single-threaded dispatcher (one agent at a time)
- Polling-based UI updates (no WebSocket yet)
- CLI for queue operations

```bash
# Add work
./cli.js add "Build login page" --priority=high

# List queue
./cli.js list

# Start agent for next item
./cli.js dispatch

# Check status
./cli.js status
```
