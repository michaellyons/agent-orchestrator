/**
 * Event Stream - Central event bus for orchestrator
 * 
 * Collects events from queue, agents, dispatcher
 * and broadcasts to subscribers (UI, logs, webhooks).
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

const EVENTS_LOG = path.join(__dirname, '../../data/events.jsonl');

class EventStream extends EventEmitter {
  constructor() {
    super();
    this.subscribers = new Map();
    this.eventLog = [];
    this.maxLogSize = 1000;
  }

  /**
   * Emit an event and log it
   */
  async publish(eventType, data) {
    const event = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    };
    
    // Add to in-memory log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
    
    // Emit to listeners
    this.emit(eventType, event);
    this.emit('*', event); // Wildcard for catch-all subscribers
    
    // Persist to log file
    await this.appendToLog(event);
    
    return event;
  }

  /**
   * Append event to JSONL log file
   */
  async appendToLog(event) {
    try {
      const logDir = path.dirname(EVENTS_LOG);
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(EVENTS_LOG, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('Failed to log event:', err.message);
    }
  }

  /**
   * Get recent events
   */
  getRecent(count = 50, eventType = null) {
    let events = this.eventLog;
    
    if (eventType) {
      events = events.filter(e => e.type === eventType);
    }
    
    return events.slice(-count);
  }

  /**
   * Load historical events from log file
   */
  async loadHistory(limit = 100) {
    try {
      const content = await fs.readFile(EVENTS_LOG, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      // Take last N lines
      const recentLines = lines.slice(-limit);
      
      this.eventLog = recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      
      return this.eventLog;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to load event history:', err.message);
      }
      return [];
    }
  }

  /**
   * Subscribe to events with a callback
   */
  subscribe(subscriberId, callback, eventTypes = ['*']) {
    this.subscribers.set(subscriberId, { callback, eventTypes });
    
    for (const eventType of eventTypes) {
      this.on(eventType, callback);
    }
    
    return () => this.unsubscribe(subscriberId);
  }

  /**
   * Unsubscribe
   */
  unsubscribe(subscriberId) {
    const sub = this.subscribers.get(subscriberId);
    if (sub) {
      for (const eventType of sub.eventTypes) {
        this.off(eventType, sub.callback);
      }
      this.subscribers.delete(subscriberId);
    }
  }

  /**
   * Get subscriber count
   */
  subscriberCount() {
    return this.subscribers.size;
  }
}

// Event type constants
const EventTypes = {
  // Queue events
  WORK_ADDED: 'work:added',
  WORK_UPDATED: 'work:updated',
  WORK_STATUS_CHANGED: 'work:status_changed',
  WORK_DISPATCHED: 'work:dispatched',
  WORK_COMPLETED: 'work:completed',
  WORK_BLOCKED: 'work:blocked',
  
  // Agent events
  AGENT_SPAWNED: 'agent:spawned',
  AGENT_STATUS_CHANGED: 'agent:status_changed',
  AGENT_PROGRESS: 'agent:progress',
  AGENT_COMPLETED: 'agent:completed',
  AGENT_CLEANED: 'agent:cleaned',
  
  // Dispatcher events
  DISPATCHER_STARTED: 'dispatcher:started',
  DISPATCHER_STOPPED: 'dispatcher:stopped',
  DISPATCHER_ERROR: 'dispatcher:error',
  
  // System events
  SYSTEM_ERROR: 'system:error',
  SYSTEM_INFO: 'system:info',
};

// Singleton
const eventStream = new EventStream();

module.exports = { eventStream, EventTypes };
