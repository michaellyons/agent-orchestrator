/**
 * User Management & Accounting
 * 
 * Tracks user activity, resource usage, and maintains credit scores
 * based on agent artifact KPIs.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '../../data/users.json');

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.dirname(USERS_FILE);
  await fs.mkdir(dataDir, { recursive: true });
}

// Load users from disk
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { users: {} };
    }
    throw err;
  }
}

// Save users to disk
async function saveUsers(data) {
  await ensureDataDir();
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create or get a user
 */
async function getOrCreate(userId, metadata = {}) {
  const data = await loadUsers();
  
  if (!data.users[userId]) {
    data.users[userId] = {
      id: userId,
      createdAt: new Date().toISOString(),
      metadata: metadata,
      
      // Accounting
      accounting: {
        tasksSubmitted: 0,
        tasksCompleted: 0,
        tasksAbandoned: 0,
        tasksInFlight: 0,
        totalExecutionTimeMs: 0,
        totalArtifacts: 0,
        artifactsAccepted: 0,
        artifactsRejected: 0,
      },
      
      // Usage tracking
      usage: {
        lastActive: new Date().toISOString(),
        sessionsSpawned: 0,
        tokensUsed: 0,
        creditsConsumed: 0,
        monthlyUsage: {},  // { "2026-02": { tasks: N, tokens: N } }
      },
      
      // Credit score (computed)
      creditScore: {
        current: 500,  // Start at 500 (neutral)
        history: [],   // [{ date, score, delta, reason }]
        components: {
          completionRate: 0,
          efficiency: 0,
          quality: 0,
          complexity: 0,
          consistency: 0,
        },
        tier: 'bronze',  // bronze | silver | gold | platinum
      },
    };
    
    await saveUsers(data);
  }
  
  return data.users[userId];
}

/**
 * Get user by ID
 */
async function get(userId) {
  const data = await loadUsers();
  return data.users[userId] || null;
}

/**
 * List all users
 */
async function list() {
  const data = await loadUsers();
  return Object.values(data.users);
}

/**
 * Record task submission
 */
async function recordTaskSubmitted(userId, taskMetadata = {}) {
  const data = await loadUsers();
  const user = data.users[userId];
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  user.accounting.tasksSubmitted++;
  user.usage.lastActive = new Date().toISOString();
  
  // Track monthly
  const month = new Date().toISOString().slice(0, 7);
  if (!user.usage.monthlyUsage[month]) {
    user.usage.monthlyUsage[month] = { tasks: 0, tokens: 0, completed: 0 };
  }
  user.usage.monthlyUsage[month].tasks++;
  
  await saveUsers(data);
  return user;
}

/**
 * Record task completion with KPIs
 */
async function recordTaskCompleted(userId, kpis = {}) {
  const data = await loadUsers();
  const user = data.users[userId];
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  const {
    executionTimeMs = 0,
    estimatedTimeMs = 0,
    artifactsProduced = 0,
    complexity = 'medium',  // low | medium | high | critical
    tokensUsed = 0,
    success = true,
  } = kpis;
  
  // Update accounting
  user.accounting.tasksCompleted++;
  user.accounting.totalExecutionTimeMs += executionTimeMs;
  user.accounting.totalArtifacts += artifactsProduced;
  
  // Update usage
  user.usage.lastActive = new Date().toISOString();
  user.usage.tokensUsed += tokensUsed;
  
  const month = new Date().toISOString().slice(0, 7);
  if (!user.usage.monthlyUsage[month]) {
    user.usage.monthlyUsage[month] = { tasks: 0, tokens: 0, completed: 0 };
  }
  user.usage.monthlyUsage[month].completed++;
  user.usage.monthlyUsage[month].tokens += tokensUsed;
  
  // Calculate credit score impact
  const scoreDelta = calculateScoreDelta(user, kpis);
  await updateCreditScore(data, userId, scoreDelta, 'task_completed', kpis);
  
  await saveUsers(data);
  return user;
}

/**
 * Record artifact review (acceptance/rejection)
 */
async function recordArtifactReview(userId, accepted = true, feedback = '') {
  const data = await loadUsers();
  const user = data.users[userId];
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  if (accepted) {
    user.accounting.artifactsAccepted++;
  } else {
    user.accounting.artifactsRejected++;
  }
  
  // Quality impacts credit score
  const scoreDelta = accepted ? 5 : -10;
  await updateCreditScore(data, userId, scoreDelta, accepted ? 'artifact_accepted' : 'artifact_rejected');
  
  await saveUsers(data);
  return user;
}

/**
 * Record task abandoned/failed
 */
async function recordTaskAbandoned(userId, reason = '') {
  const data = await loadUsers();
  const user = data.users[userId];
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  user.accounting.tasksAbandoned++;
  
  // Abandonment hurts credit score
  await updateCreditScore(data, userId, -15, 'task_abandoned', { reason });
  
  await saveUsers(data);
  return user;
}

/**
 * Calculate score delta based on KPIs
 */
function calculateScoreDelta(user, kpis) {
  let delta = 0;
  
  const {
    executionTimeMs = 0,
    estimatedTimeMs = 0,
    complexity = 'medium',
    success = true,
  } = kpis;
  
  // Base points for completion
  const complexityPoints = {
    low: 5,
    medium: 10,
    high: 20,
    critical: 35,
  };
  delta += complexityPoints[complexity] || 10;
  
  // Efficiency bonus/penalty
  if (estimatedTimeMs > 0 && executionTimeMs > 0) {
    const efficiency = estimatedTimeMs / executionTimeMs;
    if (efficiency >= 1.5) {
      delta += 10;  // 50%+ faster than estimate
    } else if (efficiency >= 1.0) {
      delta += 5;   // On time or faster
    } else if (efficiency < 0.5) {
      delta -= 5;   // Took 2x+ longer
    }
  }
  
  // Failure penalty
  if (!success) {
    delta = Math.min(delta, 0) - 10;
  }
  
  return delta;
}

/**
 * Update credit score with new delta
 */
async function updateCreditScore(data, userId, delta, reason, metadata = {}) {
  const user = data.users[userId];
  const oldScore = user.creditScore.current;
  
  // Apply delta with bounds [100, 900]
  user.creditScore.current = Math.max(100, Math.min(900, oldScore + delta));
  
  // Record history
  user.creditScore.history.push({
    date: new Date().toISOString(),
    oldScore,
    newScore: user.creditScore.current,
    delta,
    reason,
    metadata,
  });
  
  // Keep last 100 history entries
  if (user.creditScore.history.length > 100) {
    user.creditScore.history = user.creditScore.history.slice(-100);
  }
  
  // Recalculate components
  user.creditScore.components = calculateComponents(user);
  
  // Update tier
  user.creditScore.tier = calculateTier(user.creditScore.current);
  
  return user.creditScore;
}

/**
 * Calculate score components
 */
function calculateComponents(user) {
  const { accounting } = user;
  
  // Completion rate (0-100)
  const totalTasks = accounting.tasksCompleted + accounting.tasksAbandoned;
  const completionRate = totalTasks > 0 
    ? Math.round((accounting.tasksCompleted / totalTasks) * 100)
    : 0;
  
  // Efficiency (based on average vs expected - placeholder)
  const efficiency = 50; // Would need more data to calculate properly
  
  // Quality (artifact acceptance rate)
  const totalArtifacts = accounting.artifactsAccepted + accounting.artifactsRejected;
  const quality = totalArtifacts > 0
    ? Math.round((accounting.artifactsAccepted / totalArtifacts) * 100)
    : 0;
  
  // Complexity (weighted average of task complexities - placeholder)
  const complexity = 50;
  
  // Consistency (variance in performance - placeholder)
  const consistency = 50;
  
  return {
    completionRate,
    efficiency,
    quality,
    complexity,
    consistency,
  };
}

/**
 * Calculate tier from score
 */
function calculateTier(score) {
  if (score >= 800) return 'platinum';
  if (score >= 650) return 'gold';
  if (score >= 500) return 'silver';
  return 'bronze';
}

/**
 * Get leaderboard
 */
async function getLeaderboard(limit = 10) {
  const users = await list();
  
  return users
    .sort((a, b) => b.creditScore.current - a.creditScore.current)
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      score: u.creditScore.current,
      tier: u.creditScore.tier,
      tasksCompleted: u.accounting.tasksCompleted,
      qualityRate: u.creditScore.components.quality,
    }));
}

/**
 * Get user stats summary
 */
async function getStats(userId) {
  const user = await get(userId);
  if (!user) return null;
  
  const { accounting, usage, creditScore } = user;
  
  return {
    userId: user.id,
    memberSince: user.createdAt,
    
    // Credit
    creditScore: creditScore.current,
    tier: creditScore.tier,
    scoreComponents: creditScore.components,
    
    // Activity
    tasksSubmitted: accounting.tasksSubmitted,
    tasksCompleted: accounting.tasksCompleted,
    completionRate: accounting.tasksSubmitted > 0
      ? Math.round((accounting.tasksCompleted / accounting.tasksSubmitted) * 100)
      : 0,
    
    // Quality
    totalArtifacts: accounting.totalArtifacts,
    artifactAcceptanceRate: (accounting.artifactsAccepted + accounting.artifactsRejected) > 0
      ? Math.round((accounting.artifactsAccepted / (accounting.artifactsAccepted + accounting.artifactsRejected)) * 100)
      : 0,
    
    // Usage
    lastActive: usage.lastActive,
    tokensUsed: usage.tokensUsed,
    recentHistory: creditScore.history.slice(-10),
  };
}

module.exports = {
  getOrCreate,
  get,
  list,
  recordTaskSubmitted,
  recordTaskCompleted,
  recordArtifactReview,
  recordTaskAbandoned,
  getLeaderboard,
  getStats,
  loadUsers,
  saveUsers,
};
