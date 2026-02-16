#!/usr/bin/env node

/**
 * Project-Scoped CLI
 * 
 * All commands require --project <id> for isolation.
 * Each project is completely separate with its own data.
 */

const projects = require('./src/projects');
const queue = require('./src/queue/isolated');
const { ProjectExecutor } = require('./src/executor/project-scoped');

const args = process.argv.slice(2);
const command = args[0];

// Parse flags
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      flags[key] = value;
      if (value !== true) i++;
    }
  }
  return flags;
}

const flags = parseFlags(args);

// Require project flag for most commands
function requireProject() {
  if (!flags.project && command !== 'project' && command !== 'projects') {
    console.error('❌ Error: --project <id> required for this command');
    console.error('   Use: project list to see available projects');
    process.exit(1);
  }
  return flags.project;
}

async function main() {
  switch (command) {
    // ========== PROJECT MANAGEMENT ==========
    
    case 'project':
      if (args[1] === 'create') {
        const name = args[2];
        if (!name) {
          console.error('Usage: project create "Project Name"');
          process.exit(1);
        }
        const project = await projects.createProject(name, {
          description: flags.description || '',
          maxConcurrent: parseInt(flags.maxConcurrent) || 2,
        });
        console.log(`✅ Created project: ${project.name}`);
        console.log(`   ID: ${project.id}`);
        console.log(`   Use: --project ${project.id} for all commands`);
      } else if (args[1] === 'list') {
        const list = await projects.listProjects();
        console.log('\n📁 Projects:\n');
        for (const p of list) {
          console.log(`   ${p.id.slice(0, 12)}...  ${p.name}`);
          console.log(`           ${p.stats.totalItems} items · ${p.stats.completedItems} done`);
        }
        console.log(`\n   ${list.length} project(s)\n`);
      } else if (args[1] === 'show') {
        const id = args[2];
        const p = await projects.getProject(id);
        if (!p) {
          console.error('Project not found');
          process.exit(1);
        }
        console.log(`\n📁 ${p.name}`);
        console.log(`   ID: ${p.id}`);
        console.log(`   Created: ${new Date(p.createdAt).toLocaleDateString()}`);
        console.log(`   Config:`);
        console.log(`     Max Concurrent: ${p.config.maxConcurrent}`);
        console.log(`     Repo Creation: ${p.config.allowRepoCreation ? '✅' : '❌'}`);
      } else if (args[1] === 'delete') {
        const id = args[2];
        if (!id) {
          console.error('Usage: project delete <project-id>');
          process.exit(1);
        }
        if (!flags.confirm) {
          console.error('⚠️  Add --confirm to permanently delete project and all data');
          process.exit(1);
        }
        await projects.deleteProject(id);
        console.log(`✅ Deleted project ${id}`);
      }
      break;

    // ========== QUEUE COMMANDS (PROJECT-SCOPED) ==========
    
    case 'add':
    case 'enqueue': {
      const projectId = requireProject();
      const title = args[1];
      if (!title) {
        console.error('Usage: add "Task title" --project <id> [--priority high]');
        process.exit(1);
      }
      
      const item = await queue.enqueue(projectId, {
        title,
        priority: flags.priority || 'medium',
        description: flags.description || '',
      });
      
      console.log(`✅ Added to project ${projectId.slice(0, 12)}:`);
      console.log(`   ${item.id} - ${item.title}`);
      break;
    }
    
    case 'list':
    case 'ls': {
      const projectId = requireProject();
      const items = await queue.list(projectId, flags.status);
      
      console.log(`\n📋 Work Items (${items.length} total)\n`);
      
      const byStatus = {};
      for (const item of items) {
        byStatus[item.status] = byStatus[item.status] || [];
        byStatus[item.status].push(item);
      }
      
      for (const [status, statusItems] of Object.entries(byStatus)) {
        const icon = {
          inbox: '📥', ready: '📋', in_flight: '🚀',
          done: '✅', blocked: '🚫', review: '👀'
        }[status] || '❓';
        
        console.log(`${icon} ${status.toUpperCase()} (${statusItems.length})`);
        for (const item of statusItems.slice(0, 10)) {
          const priority = typeof item.priority === 'boolean' ? 'high' : item.priority;
          console.log(`   ${item.id.slice(0, 8)}  [${priority}] ${item.title}`);
        }
        if (statusItems.length > 10) {
          console.log(`   ... and ${statusItems.length - 10} more`);
        }
        console.log();
      }
      break;
    }
    
    case 'ready': {
      const projectId = requireProject();
      const id = args[1];
      if (!id) {
        console.error('Usage: ready <item-id> --project <id>');
        process.exit(1);
      }
      
      const item = await queue.ready(projectId, id);
      console.log(`🟢 Ready: ${item.title}`);
      break;
    }
    
    case 'exec':
    case 'execute': {
      const projectId = requireProject();
      const id = args[1];
      if (!id) {
        console.error('Usage: exec <item-id> --project <id>');
        process.exit(1);
      }
      
      const executor = new ProjectExecutor(projectId, { mode: flags.mock ? 'mock' : 'external' });
      const result = await executor.executeItem(id);
      
      console.log(`\n🚀 Executing in project ${projectId.slice(0, 12)}:`);
      console.log(`   Task: ${result.workItemId}`);
      console.log(`   Agent: ${result.agentId}`);
      console.log(`   Workspace: ${result.workspaceDir}`);
      console.log(`\n💡 To complete with OpenClaw:`);
      console.log(`   sessions_spawn --task "$(cat ${result.workspaceDir}/TASK.md)" --label "${result.sessionsSpawnConfig.label}"`);
      break;
    }
    
    case 'check': {
      const projectId = requireProject();
      const agentId = args[1];
      if (!agentId) {
        console.error('Usage: check <agent-id> --project <id>');
        process.exit(1);
      }
      
      const executor = new ProjectExecutor(projectId);
      const result = await executor.checkCompletion(agentId);
      
      if (result.status === 'completed') {
        console.log(`✅ Completed: ${result.workItemId}`);
        console.log(`   Artifacts: ${result.artifacts.length}`);
      } else if (result.status === 'blocked') {
        console.log(`🚫 Blocked: ${result.workItemId}`);
        console.log(`   ${result.blockerReport}`);
      } else {
        console.log(`⏳ Still running: ${result.workItemId}`);
      }
      break;
    }
    
    case 'stats': {
      const projectId = requireProject();
      const s = await queue.stats(projectId);
      
      console.log(`\n📊 Project ${projectId.slice(0, 12)} Stats:\n`);
      console.log(`   Total Items: ${s.total}`);
      console.log(`   📥 Inbox: ${s.byStatus.inbox}`);
      console.log(`   📋 Ready: ${s.byStatus.ready}`);
      console.log(`   🚀 In Flight: ${s.byStatus.in_flight}`);
      console.log(`   ✅ Done: ${s.byStatus.done}`);
      if (s.byStatus.blocked > 0) {
        console.log(`   🚫 Blocked: ${s.byStatus.blocked}`);
      }
      console.log();
      break;
    }
    
    default:
      console.log(`
🎯 Agent Orchestrator - Project-Scoped CLI

PROJECT MANAGEMENT:
  project create "Name" [--description "..."]  Create new isolated project
  project list                                      List all projects
  project show <id>                                 Show project details
  project delete <id> --confirm                     Delete project (permanent)

QUEUE COMMANDS (require --project <id>):
  add "Task" --project <id> [--priority high]     Add work item
  list --project <id> [--status=ready]              List items
  ready <id> --project <id>                         Mark item ready
  exec <id> --project <id> [--mock]               Execute item
  check <agent-id> --project <id>                  Check execution
  stats --project <id>                              Show project stats

EXAMPLES:
  # Create and work with a project
  ./project-cli.js project create "My API"
  ./project-cli.js add "Build auth" --project abc123 --priority urgent
  ./project-cli.js ready abc456 --project abc123
  ./project-cli.js exec abc456 --project abc123
`);
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
