/**
 * Queue Manager Tests
 * 
 * Business Requirements:
 * - Work items can be added to the queue
 * - Items have lifecycle states (inbox → ready → in_flight → done)
 * - Items can be claimed by agents (atomic)
 * - Priority ordering affects claim order
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as queue from './index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_QUEUE_FILE = path.join(__dirname, '../../data/queue.json');

describe('Queue Manager', () => {
  
  beforeEach(async () => {
    // Clear queue before each test
    await queue.saveQueue({ items: [], agents: [] });
  });
  
  afterEach(async () => {
    // Cleanup
    await queue.saveQueue({ items: [], agents: [] });
  });
  
  // ============================================
  // ENQUEUE - Adding work items
  // ============================================
  
  describe('enqueue()', () => {
    
    it('should add a work item with generated ID', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      
      expect(item.id).toBeDefined();
      expect(item.id.length).toBe(16); // 8 bytes hex
      expect(item.title).toBe('Test task');
    });
    
    it('should set initial status to inbox', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      
      expect(item.status).toBe('inbox');
    });
    
    it('should set default priority to medium', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      
      expect(item.priority).toBe('medium');
    });
    
    it('should respect provided priority', async () => {
      const item = await queue.enqueue({ 
        title: 'Urgent task', 
        priority: 'urgent' 
      });
      
      expect(item.priority).toBe('urgent');
    });
    
    it('should set timestamps on creation', async () => {
      const before = new Date().toISOString();
      const item = await queue.enqueue({ title: 'Test task' });
      const after = new Date().toISOString();
      
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item.createdAt >= before).toBe(true);
      expect(item.createdAt <= after).toBe(true);
    });
    
    it('should persist item to storage', async () => {
      const item = await queue.enqueue({ title: 'Persisted task' });
      
      const loaded = await queue.get(item.id);
      expect(loaded).toBeDefined();
      expect(loaded.title).toBe('Persisted task');
    });
    
  });
  
  // ============================================
  // LIST - Retrieving work items
  // ============================================
  
  describe('list()', () => {
    
    it('should return empty array when queue is empty', async () => {
      const items = await queue.list();
      
      expect(items).toEqual([]);
    });
    
    it('should return all items when no filter', async () => {
      await queue.enqueue({ title: 'Task 1' });
      await queue.enqueue({ title: 'Task 2' });
      await queue.enqueue({ title: 'Task 3' });
      
      const items = await queue.list();
      
      expect(items.length).toBe(3);
    });
    
    it('should filter by status when provided', async () => {
      const item1 = await queue.enqueue({ title: 'Inbox task' });
      const item2 = await queue.enqueue({ title: 'Ready task' });
      await queue.ready(item2.id);
      
      const inboxItems = await queue.list('inbox');
      const readyItems = await queue.list('ready');
      
      expect(inboxItems.length).toBe(1);
      expect(readyItems.length).toBe(1);
      expect(inboxItems[0].title).toBe('Inbox task');
      expect(readyItems[0].title).toBe('Ready task');
    });
    
  });
  
  // ============================================
  // STATUS TRANSITIONS
  // ============================================
  
  describe('status transitions', () => {
    
    it('ready() should move item from inbox to ready', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      expect(item.status).toBe('inbox');
      
      const updated = await queue.ready(item.id);
      
      expect(updated.status).toBe('ready');
    });
    
    it('complete() should move item to done', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const completed = await queue.complete(item.id, []);
      
      expect(completed.status).toBe('done');
    });
    
    it('complete() should attach artifacts', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      const artifacts = [
        { id: 'a1', type: 'file', path: '/test.txt' }
      ];
      
      const completed = await queue.complete(item.id, artifacts);
      
      expect(completed.artifacts).toEqual(artifacts);
    });
    
  });
  
  // ============================================
  // CLAIM - Atomic work assignment
  // ============================================
  
  describe('claim()', () => {
    
    it('should return null when no ready items', async () => {
      await queue.enqueue({ title: 'Inbox task' }); // Not ready
      
      const claimed = await queue.claim('agent-1');
      
      expect(claimed).toBeNull();
    });
    
    it('should claim highest priority ready item', async () => {
      const low = await queue.enqueue({ title: 'Low', priority: 'low' });
      const high = await queue.enqueue({ title: 'High', priority: 'high' });
      const medium = await queue.enqueue({ title: 'Medium', priority: 'medium' });
      
      await queue.ready(low.id);
      await queue.ready(high.id);
      await queue.ready(medium.id);
      
      const claimed = await queue.claim('agent-1');
      
      expect(claimed.title).toBe('High');
      expect(claimed.priority).toBe('high');
    });
    
    it('should set status to in_flight when claimed', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const claimed = await queue.claim('agent-1');
      
      expect(claimed.status).toBe('in_flight');
    });
    
    it('should assign agent ID when claimed', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const claimed = await queue.claim('agent-123');
      
      expect(claimed.assignedAgentId).toBe('agent-123');
    });
    
    it('should not allow double-claiming', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const claimed1 = await queue.claim('agent-1');
      const claimed2 = await queue.claim('agent-2');
      
      expect(claimed1).not.toBeNull();
      expect(claimed2).toBeNull(); // No more ready items
    });
    
    it('should respect priority order: urgent > high > medium > low', async () => {
      const items = await Promise.all([
        queue.enqueue({ title: 'Low', priority: 'low' }),
        queue.enqueue({ title: 'Medium', priority: 'medium' }),
        queue.enqueue({ title: 'Urgent', priority: 'urgent' }),
        queue.enqueue({ title: 'High', priority: 'high' }),
      ]);
      
      // Ready all
      for (const item of items) {
        await queue.ready(item.id);
      }
      
      // Claim in order
      const first = await queue.claim('agent-1');
      const second = await queue.claim('agent-2');
      const third = await queue.claim('agent-3');
      const fourth = await queue.claim('agent-4');
      
      expect(first.priority).toBe('urgent');
      expect(second.priority).toBe('high');
      expect(third.priority).toBe('medium');
      expect(fourth.priority).toBe('low');
    });
    
  });
  
  // ============================================
  // STATS - Queue statistics
  // ============================================
  
  describe('stats()', () => {
    
    it('should return correct total count', async () => {
      await queue.enqueue({ title: 'Task 1' });
      await queue.enqueue({ title: 'Task 2' });
      
      const stats = await queue.stats();
      
      expect(stats.total).toBe(2);
    });
    
    it('should return counts by status', async () => {
      const item1 = await queue.enqueue({ title: 'Inbox' });
      const item2 = await queue.enqueue({ title: 'Ready' });
      await queue.ready(item2.id);
      
      const stats = await queue.stats();
      
      expect(stats.byStatus.inbox).toBe(1);
      expect(stats.byStatus.ready).toBe(1);
    });
    
  });
  
});
