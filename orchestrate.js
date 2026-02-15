#!/usr/bin/env node

/**
 * Orchestrate - Simple interface for OpenClaw integration
 * 
 * Usage (from OpenClaw):
 *   node orchestrate.js status          # Get queue status
 *   node orchestrate.js next            # Prepare next item for dispatch
 *   node orchestrate.js check <agentId> # Check if agent completed
 * 
 * Output is JSON for easy parsing by OpenClaw
 */

const { prepareDispatch, checkAndFinalize, getStatusSummary } = require('./src/integrations/openclaw');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'status': {
      const status = await getStatusSummary();
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    
    case 'next': {
      const workItemId = args[1]; // Optional specific ID
      const result = await prepareDispatch(workItemId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    
    case 'check': {
      const agentId = args[1];
      if (!agentId) {
        console.log(JSON.stringify({ error: 'Agent ID required' }));
        process.exit(1);
      }
      const result = await checkAndFinalize(agentId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    
    default:
      console.log(JSON.stringify({
        error: 'Unknown command',
        usage: {
          status: 'Get queue status',
          next: 'Prepare next item for dispatch (optional: item ID)',
          check: 'Check agent completion (required: agent ID)',
        }
      }));
  }
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
