/**
 * Redis Queue Adapter
 * 
 * Provides pub/sub subscription model for agent runtimes.
 * Falls back to file-based queue when Redis unavailable.
 */

const { createClient } = require('redis');
const { EventEmitter } = require('events');
const fileQueue = require('./index');

const CHANNELS = {
  WORK_AVAILABLE: 'orchestrator:work:available',
  WORK_CLAIMED: 'orchestrator:work:claimed',
  WORK_COMPLETED: 'orchestrator:work:completed',
  AGENT_HEARTBEAT: 'orchestrator:agent:heartbeat',
};

const KEYS = {
  QUEUE: 'orchestrator:queue',
  AGENTS: 'orchestrator:agents',
  WORK_ITEMS: 'orchestrator:items',
};

class RedisQueueAdapter extends EventEmitter {
  constructor(redisUrl) {
    super();
    this.redisUrl = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = null;
    this.subscriber = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;

    try {
      this.client = createClient({ url: this.redisUrl });
      this.subscriber = this.client.duplicate();

      this.client.on('error', err => console.error('Redis client error:', err));
      this.subscriber.on('error', err => console.error('Redis subscriber error:', err));

      await this.client.connect();
      await this.subscriber.connect();
      
      this.connected = true;
      console.log('📡 Connected to Redis');
    } catch (err) {
      console.warn('⚠️ Redis unavailable, using file-based queue:', err.message);
      this.connected = false;
    }
  }

  async disconnect() {
    if (this.client) await this.client.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.connected = false;
  }

  /**
   * Enqueue a work item and notify subscribers
   */
  async enqueue(item) {
    // Always use file queue as source of truth
    const workItem = await fileQueue.enqueue(item);

    if (this.connected) {
      // Store in Redis for quick access
      await this.client.hSet(KEYS.WORK_ITEMS, workItem.id, JSON.stringify(workItem));
      
      // Add to sorted set by priority
      const priorityScore = { urgent: 0, high: 1, medium: 2, low: 3 }[workItem.priority] || 2;
      await this.client.zAdd(KEYS.QUEUE, { score: priorityScore, value: workItem.id });
    }

    return workItem;
  }

  /**
   * Mark item as ready and publish notification
   */
  async ready(id) {
    const updated = await fileQueue.ready(id);

    if (this.connected) {
      await this.client.hSet(KEYS.WORK_ITEMS, id, JSON.stringify(updated));
      
      // Publish work available event
      await this.client.publish(CHANNELS.WORK_AVAILABLE, JSON.stringify({
        id: updated.id,
        title: updated.title,
        priority: updated.priority,
        timestamp: new Date().toISOString(),
      }));
    }

    return updated;
  }

  /**
   * Atomic claim - returns item or null if already claimed
   */
  async claim(agentId) {
    if (this.connected) {
      // Use Redis for atomic claim
      const script = `
        local items = redis.call('ZRANGE', KEYS[1], 0, -1)
        for _, itemId in ipairs(items) do
          local item = redis.call('HGET', KEYS[2], itemId)
          if item then
            local parsed = cjson.decode(item)
            if parsed.status == 'ready' then
              parsed.status = 'in_flight'
              parsed.assignedAgentId = ARGV[1]
              parsed.updatedAt = ARGV[2]
              redis.call('HSET', KEYS[2], itemId, cjson.encode(parsed))
              redis.call('ZREM', KEYS[1], itemId)
              return cjson.encode(parsed)
            end
          end
        end
        return nil
      `;

      try {
        const result = await this.client.eval(script, {
          keys: [KEYS.QUEUE, KEYS.WORK_ITEMS],
          arguments: [agentId, new Date().toISOString()],
        });

        if (result) {
          const claimed = JSON.parse(result);
          // Sync back to file
          await fileQueue.update(claimed.id, {
            status: 'in_flight',
            assignedAgentId: agentId,
          });
          
          // Publish claimed event
          await this.client.publish(CHANNELS.WORK_CLAIMED, JSON.stringify({
            id: claimed.id,
            agentId,
            timestamp: new Date().toISOString(),
          }));
          
          return claimed;
        }
      } catch (err) {
        console.error('Redis claim error:', err);
      }
    }

    // Fallback to file-based
    return fileQueue.claim(agentId);
  }

  /**
   * Complete a work item
   */
  async complete(id, artifacts = []) {
    const completed = await fileQueue.complete(id, artifacts);

    if (this.connected) {
      await this.client.hSet(KEYS.WORK_ITEMS, id, JSON.stringify(completed));
      await this.client.zRem(KEYS.QUEUE, id);
      
      await this.client.publish(CHANNELS.WORK_COMPLETED, JSON.stringify({
        id,
        artifacts: artifacts.length,
        timestamp: new Date().toISOString(),
      }));
    }

    return completed;
  }

  /**
   * Subscribe to work available events
   */
  async subscribe(callback) {
    if (!this.connected) {
      console.warn('⚠️ Cannot subscribe: Redis not connected');
      return null;
    }

    await this.subscriber.subscribe(CHANNELS.WORK_AVAILABLE, (message) => {
      try {
        const data = JSON.parse(message);
        callback(data);
      } catch (err) {
        console.error('Failed to parse work event:', err);
      }
    });

    console.log('🔔 Subscribed to work events');
    return CHANNELS.WORK_AVAILABLE;
  }

  /**
   * Register agent heartbeat
   */
  async heartbeat(agentId, status = 'idle') {
    if (!this.connected) return;

    const agentData = {
      id: agentId,
      status,
      lastSeen: new Date().toISOString(),
    };

    await this.client.hSet(KEYS.AGENTS, agentId, JSON.stringify(agentData));
    await this.client.publish(CHANNELS.AGENT_HEARTBEAT, JSON.stringify(agentData));
  }

  /**
   * Get all registered agents
   */
  async getAgents() {
    if (!this.connected) return [];

    const agents = await this.client.hGetAll(KEYS.AGENTS);
    return Object.values(agents).map(a => JSON.parse(a));
  }

  /**
   * Proxy methods to file queue
   */
  list(status) { return fileQueue.list(status); }
  get(id) { return fileQueue.get(id); }
  update(id, updates) { return fileQueue.update(id, updates); }
  stats() { return fileQueue.stats(); }
}

// Singleton
let adapter = null;

async function getAdapter() {
  if (!adapter) {
    adapter = new RedisQueueAdapter();
    await adapter.connect();
  }
  return adapter;
}

module.exports = {
  RedisQueueAdapter,
  getAdapter,
  CHANNELS,
};
