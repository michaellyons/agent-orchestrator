/**
 * Executor Tests
 * 
 * Business Requirements:
 * - Executor spawns isolated agents for work items
 * - Respects concurrency limits
 * - Tracks execution state
 * - Handles completion and blocking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Executor } from './index.js';
import * as queue from '../queue/index.js';
import * as projects from '../projects/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');

describe('Executor', () => {
  let executor;
  
  beforeEach(async () => {
    // Clear data
    await queue.saveQueue({ items: [], agents: [] });
    await projects.saveProjects({ projects: [] });
    
    // Clear agent directories
    const agentsDir = path.join(DATA_DIR, 'agents');
    try {
      const dirs = await fs.readdir(agentsDir);
      for (const dir of dirs) {
        await fs.rm(path.join(agentsDir, dir), { recursive: true });
      }
    } catch (e) {
      // Directory might not exist
    }
    
    // Create fresh executor in mock mode
    executor = new Executor({ mode: 'mock', maxConcurrent: 2 });
  });
  
  afterEach(async () => {
    // Cleanup
    await queue.saveQueue({ items: [], agents: [] });
    await projects.saveProjects({ projects: [] });
  });
  
  // ============================================
  // EXECUTE ITEM - Single item execution
  // ============================================
  
  describe('executeItem()', () => {
    
    it('should execute a work item', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const result = await executor.executeItem(item.id);
      
      expect(result.agentId).toBeDefined();
      expect(result.workItemId).toBe(item.id);
    });
    
    it('should auto-ready inbox items', async () => {
      const item = await queue.enqueue({ title: 'Inbox task' });
      expect(item.status).toBe('inbox');
      
      const result = await executor.executeItem(item.id);
      
      expect(result).toBeDefined();
      expect(result.agentId).toBeDefined();
    });
    
    it('should support partial ID matching', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const partialId = item.id.slice(0, 8);
      const result = await executor.executeItem(partialId);
      
      expect(result.workItemId).toBe(item.id);
    });
    
    it('should throw for nonexistent item', async () => {
      await expect(
        executor.executeItem('nonexistent')
      ).rejects.toThrow('not found');
    });
    
    it('should throw for already in-flight item', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      await queue.claim('other-agent');
      
      await expect(
        executor.executeItem(item.id)
      ).rejects.toThrow('cannot execute');
    });
    
    it('should create isolated workspace in mock mode', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const result = await executor.executeItem(item.id);
      
      // Check workspace was created
      const workspaceExists = await fs.access(
        path.join(DATA_DIR, 'agents', result.agentId, 'workspace')
      ).then(() => true).catch(() => false);
      
      expect(workspaceExists).toBe(true);
    });
    
    it('should create COMPLETION.md in mock mode', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const result = await executor.executeItem(item.id);
      
      const completionExists = await fs.access(
        path.join(DATA_DIR, 'agents', result.agentId, 'artifacts', 'COMPLETION.md')
      ).then(() => true).catch(() => false);
      
      expect(completionExists).toBe(true);
    });
    
    it('should mark item as done in mock mode', async () => {
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      await executor.executeItem(item.id);
      
      const updated = await queue.get(item.id);
      expect(updated.status).toBe('done');
    });
    
  });
  
  // ============================================
  // EXECUTE PROJECT - Batch execution
  // ============================================
  
  describe('executeProject()', () => {
    
    it('should execute all items in a project', async () => {
      const project = await projects.create({ name: 'Test', maxConcurrent: 5 });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      await projects.addWorkItem(project.id, { title: 'Task 2' });
      
      const result = await executor.executeProject(project.id);
      
      expect(result.spawned).toBe(2);
    });
    
    it('should respect maxConcurrent limit', async () => {
      const project = await projects.create({ name: 'Test', maxConcurrent: 2 });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      await projects.addWorkItem(project.id, { title: 'Task 2' });
      await projects.addWorkItem(project.id, { title: 'Task 3' });
      
      // Use external mode to not auto-complete
      const extExecutor = new Executor({ mode: 'external', maxConcurrent: 2 });
      const result = await extExecutor.executeProject(project.id);
      
      expect(result.spawned).toBe(2);
      expect(result.queued).toBe(1);
    });
    
    it('should throw for nonexistent project', async () => {
      await expect(
        executor.executeProject('nonexistent')
      ).rejects.toThrow('not found');
    });
    
    it('should auto-ready all items', async () => {
      const project = await projects.create({ name: 'Test' });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      
      await executor.executeProject(project.id);
      
      const updated = await projects.get(project.id);
      expect(updated.status).toBe('active');
    });
    
  });
  
  // ============================================
  // EXECUTE NEXT - Queue-based execution
  // ============================================
  
  describe('executeNext()', () => {
    
    it('should execute next ready item', async () => {
      const item = await queue.enqueue({ title: 'Ready task' });
      await queue.ready(item.id);
      
      const result = await executor.executeNext(1);
      
      expect(result.spawned).toBe(1);
    });
    
    it('should return spawned=0 when no ready items', async () => {
      await queue.enqueue({ title: 'Inbox task' }); // Not ready
      
      const result = await executor.executeNext(1);
      
      expect(result.spawned).toBe(0);
    });
    
    it('should execute multiple items when requested', async () => {
      const item1 = await queue.enqueue({ title: 'Task 1' });
      const item2 = await queue.enqueue({ title: 'Task 2' });
      await queue.ready(item1.id);
      await queue.ready(item2.id);
      
      const result = await executor.executeNext(2);
      
      expect(result.spawned).toBe(2);
    });
    
    it('should respect priority order', async () => {
      const low = await queue.enqueue({ title: 'Low', priority: 'low' });
      const high = await queue.enqueue({ title: 'High', priority: 'high' });
      await queue.ready(low.id);
      await queue.ready(high.id);
      
      const result = await executor.executeNext(1);
      
      // Should have executed the high priority item
      const highUpdated = await queue.get(high.id);
      const lowUpdated = await queue.get(low.id);
      
      expect(highUpdated.status).toBe('done');
      expect(lowUpdated.status).toBe('ready'); // Still waiting
    });
    
  });
  
  // ============================================
  // EXECUTION STATE
  // ============================================
  
  describe('status()', () => {
    
    it('should return executor configuration', () => {
      const status = executor.status();
      
      expect(status.mode).toBe('mock');
      expect(status.maxConcurrent).toBe(2);
    });
    
    it('should track running executions in external mode', async () => {
      const extExecutor = new Executor({ mode: 'external' });
      const item = await queue.enqueue({ title: 'Test' });
      await queue.ready(item.id);
      
      await extExecutor.executeItem(item.id);
      
      const status = extExecutor.status();
      expect(status.running).toBe(1);
    });
    
  });
  
  // ============================================
  // EXTERNAL MODE - Config output
  // ============================================
  
  describe('external mode', () => {
    
    it('should return sessionsSpawnConfig', async () => {
      const extExecutor = new Executor({ mode: 'external' });
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const result = await extExecutor.executeItem(item.id);
      
      expect(result.mode).toBe('external');
      expect(result.sessionsSpawnConfig).toBeDefined();
      expect(result.sessionsSpawnConfig.task).toContain('Test task');
      expect(result.sessionsSpawnConfig.label).toContain('worker-');
    });
    
    it('should write TASK.md to workspace', async () => {
      const extExecutor = new Executor({ mode: 'external' });
      const item = await queue.enqueue({ title: 'Test task' });
      await queue.ready(item.id);
      
      const result = await extExecutor.executeItem(item.id);
      
      const taskContent = await fs.readFile(
        path.join(result.workspaceDir, 'TASK.md'),
        'utf8'
      );
      
      expect(taskContent).toContain('Test task');
    });
    
  });
  
});
