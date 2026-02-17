# Repository Provider Configuration

Configure repository providers for automatic artifact publishing.

## GitHub Setup

### 1. Environment Variables

```bash
# Required
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"  # Personal access token with repo scope

# Optional (defaults shown)
export GITHUB_ORG="michaellyons"        # Target org/user for new repos
export GITHUB_TEMPLATE="react"          # Default template
```

### 2. Token Permissions

Create token at: https://github.com/settings/tokens

**Required scopes:**
- `repo` - Full control of private repositories
- `workflow` - Update GitHub Actions workflows (optional)

### 3. Work Item Output Config

```javascript
{
  title: "Build React Dashboard",
  output: {
    type: "repo",
    name: "my-dashboard",           // Repo name (required)
    description: "Analytics dashboard", // Repo description
    template: "react",               // Template to apply
    private: false                   // Public (default) or private
  }
}
```

### 4. CLI Usage

```bash
# Add work item with repo output
node cli.js add "Build API client" --priority high

# Configure via API
curl -X POST localhost:3000/api/queue \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build API client",
    "output": {
      "type": "repo",
      "name": "api-client",
      "template": "node"
    }
  }'

# Execute (creates repo on completion)
node cli.js exec <id>
```

## Provider Extensibility

Add new providers in `src/repos/index.js`:

```javascript
const providers = {
  github: { /* ... */ },
  gitlab: {
    enabled: true,
    apiBase: 'https://gitlab.com/api/v4',
    token: process.env.GITLAB_TOKEN,
    // ...
  }
};
```

## Templates

Configure template repos:

```javascript
templates: {
  react: 'https://github.com/michaellyons/react-template',
  node: 'https://github.com/michaellyons/node-template',
  python: 'https://github.com/michaellyons/python-template'
}
```

Templates are cloned and pushed to new repos during creation.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Work Item  │ ──▶ │   Executor  │ ──▶ │   Artifacts │
│  (repo cfg) │     │   (spawns   │     │   (.jsx,    │
│             │     │    agent)   │     │   .test.jsx)│
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                 │
                                                 ▼
                                        ┌─────────────┐
                                        │ Repo Create │
                                        │  (GitHub)   │
                                        └─────────────┘
```

## Testing

Test repo creation manually:

```bash
cd ~/Developer/agent-orchestrator
node -e "
const repos = require('./src/repos');
repos.createRepo('test-repo-' + Date.now(), {
  description: 'Test repo',
  private: true
}).then(repo => {
  console.log('Created:', repo.url);
}).catch(err => {
  console.error('Failed:', err.message);
});
"
```
