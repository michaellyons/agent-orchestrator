#!/usr/bin/env node

/**
 * Agent Orchestrator CLI
 * 
 * Queue Commands:
 *   ./cli.js add "Task" --priority=high
 *   ./cli.js list [--status=ready]
 *   ./cli.js ready <id>
 * 
 * Project Commands:
 *   ./cli.js project create "Name" --description="..."
 *   ./cli.js project add <projectId> "Task" --priority=high
 *   ./cli.js project list
 *   ./cli.js project show <projectId>
 *   ./cli.js project ready <projectId>
 * 
 * Execution Commands:
 *   ./cli.js exec <id> [--mock]           # Execute single item
 *   ./cli.js exec-project <id> [--mock]   # Execute all project items
 *   ./cli.js exec-next [N] [--mock]       # Execute next N ready items
 *   ./cli.js check <agentId>              # Check execution status
 */

const queue = require('./src/queue');
const agentManager = require('./src/agents');
const projects = require('./src/projects');
const { getExecutor } = require('./src/executor');
const { eventStream } = require('./src/events');

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args) {
  const flags = {};
  const positional = [];
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  
  return { flags, positional };
}

async function main() {
  const { flags, positional } = parseFlags(args.slice(1));
  
  switch (command) {
    // ========== QUEUE COMMANDS ==========
    
    case 'add': {
      const title = positional[0];
      if (!title) {
        console.error('Usage: ./cli.js add "Task title" [--priority=high]');
        process.exit(1);
      }
      
      const item = await queue.enqueue({
        title,
        description: flags.description || '',
        priority: flags.priority || 'medium',
        complexity: flags.complexity || 'm',
        acceptanceCriteria: flags.criteria ? flags.criteria.split(',') : [],
        createdBy: flags.by || 'cli',
      });
      
      console.log(`✅ Added: ${item.id.slice(0, 8)} - ${item.title}`);
      break;
    }
    
    case 'list': {
      const items = await queue.list(flags.status || null);
      
      if (items.length === 0) {
        console.log('📭 Queue is empty');
        break;
      }
      
      const byStatus = {};
      for (const item of items) {
        byStatus[item.status] = byStatus[item.status] || [];
        byStatus[item.status].push(item);
      }
      
      const statusOrder = ['inbox', 'planning', 'ready', 'in_flight', 'review', 'done', 'blocked'];
      const emoji = { inbox: '📥', planning: '🔍', ready: '🟢', in_flight: '🚀', review: '👀', done: '✅', blocked: '🚫' };
      
      console.log(`\n📋 Work Items (${items.length}):\n`);
      
      for (const status of statusOrder) {
        const statusItems = byStatus[status];
        if (!statusItems) continue;
        
        console.log(`${emoji[status]} ${status.toUpperCase()} (${statusItems.length})`);
        for (const item of statusItems) {
          const pri = item.priority === 'urgent' ? '🔴' : item.priority === 'high' ? '🟠' : '';
          const proj = item.projectId ? `[${item.projectId.slice(0, 6)}]` : '';
          console.log(`   ${item.id.slice(0, 8)} ${pri} ${proj} ${item.title}`);
        }
        console.log('');
      }
      break;
    }
    
    case 'ready': {
      const id = positional[0];
      if (!id) {
        console.error('Usage: ./cli.js ready <id>');
        process.exit(1);
      }
      
      const items = await queue.list();
      const item = items.find(i => i.id.startsWith(id));
      
      if (!item) {
        console.error(`❌ Work item ${id} not found`);
        process.exit(1);
      }
      
      await queue.ready(item.id);
      console.log(`🟢 Ready: ${item.id.slice(0, 8)} - ${item.title}`);
      break;
    }
    
    case 'get': {
      const id = positional[0];
      if (!id) {
        console.error('Usage: ./cli.js get <id>');
        process.exit(1);
      }
      
      const items = await queue.list();
      const item = items.find(i => i.id.startsWith(id));
      
      if (!item) {
        console.error(`❌ Not found: ${id}`);
        process.exit(1);
      }
      
      console.log(JSON.stringify(item, null, 2));
      break;
    }
    
    // ========== PROJECT COMMANDS ==========
    
    case 'project': {
      const subCmd = positional[0];
      
      switch (subCmd) {
        case 'create': {
          const name = positional[1];
          if (!name) {
            console.error('Usage: ./cli.js project create "Name" [--description="..."]');
            process.exit(1);
          }
          
          const project = await projects.create({
            name,
            description: flags.description || '',
            maxConcurrent: parseInt(flags.concurrent || '2', 10),
          });
          
          console.log(`✅ Created project: ${project.id}`);
          console.log(`   Name: ${project.name}`);
          break;
        }
        
        case 'add': {
          const projId = positional[1];
          const title = positional[2];
          
          if (!projId || !title) {
            console.error('Usage: ./cli.js project add <projectId> "Task" [--priority=high]');
            process.exit(1);
          }
          
          const { project, workItem } = await projects.addWorkItem(projId, {
            title,
            description: flags.description || '',
            priority: flags.priority || 'medium',
            complexity: flags.complexity || 'm',
            acceptanceCriteria: flags.criteria ? flags.criteria.split(',') : [],
          });
          
          console.log(`✅ Added to ${project.name}: ${workItem.id.slice(0, 8)} - ${title}`);
          break;
        }
        
        case 'list': {
          const projectList = await projects.list(flags.status || null);
          
          if (projectList.length === 0) {
            console.log('📭 No projects');
            break;
          }
          
          console.log(`\n📁 Projects (${projectList.length}):\n`);
          
          for (const p of projectList) {
            const statusEmoji = { planning: '📋', active: '🚀', paused: '⏸️', completed: '✅' };
            const bar = '█'.repeat(Math.floor(p.progress.percent / 10)) + '░'.repeat(10 - Math.floor(p.progress.percent / 10));
            
            console.log(`${statusEmoji[p.status] || '📁'} ${p.id.slice(0, 8)} ${p.name}`);
            console.log(`   ${bar} ${p.progress.percent}% (${p.progress.done}/${p.progress.total})`);
            if (p.progress.inFlight > 0) console.log(`   🚀 ${p.progress.inFlight} in flight`);
            console.log('');
          }
          break;
        }
        
        case 'show': {
          const projId = positional[1];
          if (!projId) {
            console.error('Usage: ./cli.js project show <projectId>');
            process.exit(1);
          }
          
          const project = await projects.get(projId);
          if (!project) {
            console.error(`❌ Project ${projId} not found`);
            process.exit(1);
          }
          
          console.log(`\n📁 ${project.name}`);
          console.log(`   ID: ${project.id}`);
          console.log(`   Status: ${project.status}`);
          console.log(`   Description: ${project.description || '(none)'}`);
          console.log(`   Max Concurrent: ${project.config.maxConcurrent}`);
          console.log(`\n   Progress: ${project.progress.percent}%`);
          console.log(`   Done: ${project.progress.done} | Review: ${project.progress.review} | In Flight: ${project.progress.inFlight} | Blocked: ${project.progress.blocked}`);
          
          if (project.workItems.length > 0) {
            console.log(`\n   Work Items:`);
            for (const item of project.workItems) {
              const emoji = { inbox: '📥', ready: '🟢', in_flight: '🚀', review: '👀', done: '✅', blocked: '🚫' };
              console.log(`   ${emoji[item.status] || '❓'} ${item.id.slice(0, 8)} ${item.title}`);
            }
          }
          break;
        }
        
        case 'ready': {
          const projId = positional[1];
          if (!projId) {
            console.error('Usage: ./cli.js project ready <projectId>');
            process.exit(1);
          }
          
          const result = await projects.readyAll(projId);
          console.log(`🟢 Readied ${result.readiedCount} items in project ${result.projectId.slice(0, 8)}`);
          break;
        }
        
        default:
          console.log(`
Project Commands:
  project create "Name"           Create new project
          --description="..."
          --concurrent=2          Max concurrent agents
  
  project add <id> "Task"         Add task to project
          --priority=high
          --criteria="a,b,c"
  
  project list                    List all projects
  project show <id>               Show project details
  project ready <id>              Mark all items ready
`);
      }
      break;
    }
    
    // ========== EXECUTION COMMANDS ==========
    
    case 'exec': {
      const id = positional[0];
      if (!id) {
        console.error('Usage: ./cli.js exec <workItemId> [--mock]');
        process.exit(1);
      }
      
      const mode = flags.mock ? 'mock' : 'external';
      const executor = getExecutor({ mode });
      
      const result = await executor.executeItem(id);
      
      if (result.mode === 'mock') {
        console.log(`\n✅ Mock execution completed`);
        console.log(`   Artifacts: ${result.artifacts.length}`);
      } else {
        console.log(`\n📤 Ready for execution`);
        console.log(`   Agent: ${result.agentId}`);
        console.log(`   Workspace: ${result.workspaceDir}`);
        console.log(`\n💡 To spawn with OpenClaw, use sessions_spawn with:`);
        console.log(`   task: [task in TASK.md]`);
        console.log(`   label: "${result.sessionsSpawnConfig.label}"`);
        console.log(`\n   After completion: ./cli.js check ${result.agentId}`);
      }
      break;
    }
    
    case 'exec-project': {
      const id = positional[0];
      if (!id) {
        console.error('Usage: ./cli.js exec-project <projectId> [--mock]');
        process.exit(1);
      }
      
      const mode = flags.mock ? 'mock' : 'external';
      const executor = getExecutor({ mode });
      
      const result = await executor.executeProject(id);
      
      console.log(`\n🚀 Project execution started`);
      console.log(`   Spawned: ${result.spawned}`);
      console.log(`   Queued: ${result.queued}`);
      
      if (result.executions) {
        for (const exec of result.executions) {
          console.log(`\n   Agent ${exec.agentId.slice(0, 8)}:`);
          console.log(`   └─ ${exec.workspaceDir}`);
        }
      }
      break;
    }
    
    case 'exec-next': {
      const count = parseInt(positional[0] || '1', 10);
      const mode = flags.mock ? 'mock' : 'external';
      const executor = getExecutor({ mode });
      
      const result = await executor.executeNext(count);
      
      if (result.spawned === 0) {
        console.log('📭 No ready items to execute');
      } else {
        console.log(`\n🚀 Started ${result.spawned} execution(s)`);
        
        for (const exec of result.executions) {
          console.log(`\n   ${exec.agentId.slice(0, 8)}: ${exec.workItemId.slice(0, 8)}`);
          if (exec.workspaceDir) {
            console.log(`   └─ ${exec.workspaceDir}`);
          }
        }
      }
      break;
    }
    
    case 'check': {
      const agentId = positional[0];
      if (!agentId) {
        console.error('Usage: ./cli.js check <agentId>');
        process.exit(1);
      }
      
      const executor = getExecutor();
      const result = await executor.checkExecution(agentId);
      
      if (result.error) {
        console.error(`❌ ${result.error}`);
        process.exit(1);
      }
      
      const emoji = { completed: '✅', blocked: '🚫', running: '🚀' };
      console.log(`\n${emoji[result.status]} Status: ${result.status}`);
      console.log(`   Work Item: ${result.workItemId}`);
      
      if (result.artifacts) {
        console.log(`   Artifacts: ${result.artifacts.length}`);
        for (const a of result.artifacts) {
          console.log(`   - ${a.name}`);
        }
      }
      
      if (result.completionReport) {
        console.log(`\n--- Completion Report ---\n${result.completionReport}`);
      }
      
      if (result.blockerReport) {
        console.log(`\n--- Blocker Report ---\n${result.blockerReport}`);
      }
      break;
    }
    
    // ========== STATUS ==========
    
    case 'status': {
      const queueStats = await queue.stats();
      const sessions = agentManager.listSessions();
      const projectList = await projects.list();
      
      console.log('\n📊 Orchestrator Status\n');
      
      console.log('Queue:');
      console.log(`   Total: ${queueStats.total}`);
      for (const [status, count] of Object.entries(queueStats.byStatus)) {
        console.log(`   ${status}: ${count}`);
      }
      
      console.log('\nAgents:');
      console.log(`   Sessions: ${sessions.length}`);
      console.log(`   Working: ${sessions.filter(s => s.status === 'working').length}`);
      
      console.log('\nProjects:');
      console.log(`   Total: ${projectList.length}`);
      console.log(`   Active: ${projectList.filter(p => p.status === 'active').length}`);
      break;
    }
    
    case 'clear': {
      if (!flags.confirm) {
        console.log('⚠️  Use --confirm to clear all data');
        break;
      }
      
      await queue.saveQueue({ items: [], agents: [] });
      await projects.saveProjects({ projects: [] });
      console.log('🗑️  All data cleared');
      break;
    }
    
    default:
      console.log(`
Agent Orchestrator CLI

QUEUE
  add "Task"              Add work item
  list [--status=X]       List items
  ready <id>              Mark ready
  get <id>                Get item details

PROJECTS
  project create "Name"   Create project
  project add <p> "Task"  Add task to project
  project list            List projects
  project show <id>       Show project
  project ready <id>      Ready all items

EXECUTION
  exec <id> [--mock]      Execute single item
  exec-project <id>       Execute project
  exec-next [N]           Execute next N ready
  check <agentId>         Check execution

OTHER
  status                  Show stats
  clear --confirm         Clear all data
`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
