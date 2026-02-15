/**
 * Project Manager Tests
 * 
 * Business Requirements:
 * - Projects group related work items
 * - Projects track aggregate progress
 * - Projects can batch-ready all items
 * - Projects have configurable concurrency limits
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as projects from './index.js';
import * as queue from '../queue/index.js';

describe('Project Manager', () => {
  
  beforeEach(async () => {
    // Clear data before each test
    await queue.saveQueue({ items: [], agents: [] });
    await projects.saveProjects({ projects: [] });
  });
  
  afterEach(async () => {
    // Cleanup
    await queue.saveQueue({ items: [], agents: [] });
    await projects.saveProjects({ projects: [] });
  });
  
  // ============================================
  // CREATE - Creating projects
  // ============================================
  
  describe('create()', () => {
    
    it('should create a project with generated ID', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      expect(project.id).toBeDefined();
      expect(project.id.length).toBe(12); // 6 bytes hex
      expect(project.name).toBe('Test Project');
    });
    
    it('should set initial status to planning', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      expect(project.status).toBe('planning');
    });
    
    it('should set default maxConcurrent to 2', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      expect(project.config.maxConcurrent).toBe(2);
    });
    
    it('should respect provided maxConcurrent', async () => {
      const project = await projects.create({ 
        name: 'Test Project',
        maxConcurrent: 5 
      });
      
      expect(project.config.maxConcurrent).toBe(5);
    });
    
    it('should initialize empty workItemIds array', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      expect(project.workItemIds).toEqual([]);
    });
    
    it('should set timestamps', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });
    
  });
  
  // ============================================
  // ADD WORK ITEMS - Linking items to projects
  // ============================================
  
  describe('addWorkItem()', () => {
    
    it('should create work item and link to project', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      const { workItem } = await projects.addWorkItem(project.id, {
        title: 'Task 1'
      });
      
      expect(workItem.id).toBeDefined();
      expect(workItem.title).toBe('Task 1');
    });
    
    it('should add item ID to project.workItemIds', async () => {
      const project = await projects.create({ name: 'Test Project' });
      
      const { workItem } = await projects.addWorkItem(project.id, {
        title: 'Task 1'
      });
      
      const updated = await projects.get(project.id);
      expect(updated.workItemIds).toContain(workItem.id);
    });
    
    it('should support partial ID matching', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const partialId = project.id.slice(0, 6);
      
      const { workItem } = await projects.addWorkItem(partialId, {
        title: 'Task 1'
      });
      
      expect(workItem).toBeDefined();
    });
    
    it('should throw if project not found', async () => {
      await expect(
        projects.addWorkItem('nonexistent', { title: 'Task' })
      ).rejects.toThrow('not found');
    });
    
  });
  
  // ============================================
  // GET - Retrieving projects with items
  // ============================================
  
  describe('get()', () => {
    
    it('should return null for nonexistent project', async () => {
      const project = await projects.get('nonexistent');
      
      expect(project).toBeNull();
    });
    
    it('should include work items in response', async () => {
      const project = await projects.create({ name: 'Test Project' });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      await projects.addWorkItem(project.id, { title: 'Task 2' });
      
      const loaded = await projects.get(project.id);
      
      expect(loaded.workItems.length).toBe(2);
      expect(loaded.workItems[0].title).toBe('Task 1');
    });
    
    it('should calculate progress', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const { workItem: item1 } = await projects.addWorkItem(project.id, { title: 'Task 1' });
      const { workItem: item2 } = await projects.addWorkItem(project.id, { title: 'Task 2' });
      
      // Complete one item
      await queue.complete(item1.id, []);
      
      const loaded = await projects.get(project.id);
      
      expect(loaded.progress.total).toBe(2);
      expect(loaded.progress.done).toBe(1);
      expect(loaded.progress.percent).toBe(50);
    });
    
  });
  
  // ============================================
  // LIST - Listing all projects
  // ============================================
  
  describe('list()', () => {
    
    it('should return empty array when no projects', async () => {
      const projectList = await projects.list();
      
      expect(projectList).toEqual([]);
    });
    
    it('should return all projects', async () => {
      await projects.create({ name: 'Project 1' });
      await projects.create({ name: 'Project 2' });
      
      const projectList = await projects.list();
      
      expect(projectList.length).toBe(2);
    });
    
    it('should filter by status', async () => {
      const p1 = await projects.create({ name: 'Planning' });
      const p2 = await projects.create({ name: 'Active' });
      await projects.update(p2.id, { status: 'active' });
      
      const activeProjects = await projects.list('active');
      
      expect(activeProjects.length).toBe(1);
      expect(activeProjects[0].name).toBe('Active');
    });
    
    it('should include progress summary', async () => {
      const project = await projects.create({ name: 'Test Project' });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      
      const projectList = await projects.list();
      
      expect(projectList[0].progress).toBeDefined();
      expect(projectList[0].itemCount).toBe(1);
    });
    
  });
  
  // ============================================
  // READY ALL - Batch ready items
  // ============================================
  
  describe('readyAll()', () => {
    
    it('should mark all inbox items as ready', async () => {
      const project = await projects.create({ name: 'Test Project' });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      await projects.addWorkItem(project.id, { title: 'Task 2' });
      
      const result = await projects.readyAll(project.id);
      
      expect(result.readiedCount).toBe(2);
    });
    
    it('should update project status to active', async () => {
      const project = await projects.create({ name: 'Test Project' });
      await projects.addWorkItem(project.id, { title: 'Task 1' });
      
      await projects.readyAll(project.id);
      
      const updated = await projects.get(project.id);
      expect(updated.status).toBe('active');
    });
    
    it('should skip already-ready items', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const { workItem } = await projects.addWorkItem(project.id, { title: 'Task 1' });
      await queue.ready(workItem.id);
      await projects.addWorkItem(project.id, { title: 'Task 2' });
      
      const result = await projects.readyAll(project.id);
      
      expect(result.readiedCount).toBe(1); // Only the inbox item
    });
    
    it('should throw if project not found', async () => {
      await expect(
        projects.readyAll('nonexistent')
      ).rejects.toThrow('not found');
    });
    
  });
  
  // ============================================
  // PROGRESS CALCULATION
  // ============================================
  
  describe('progress calculation', () => {
    
    it('should return 0% for empty project', async () => {
      const project = await projects.create({ name: 'Empty' });
      const loaded = await projects.get(project.id);
      
      expect(loaded.progress.percent).toBe(0);
      expect(loaded.progress.total).toBe(0);
    });
    
    it('should count done and review as complete', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const { workItem: item1 } = await projects.addWorkItem(project.id, { title: 'Done' });
      const { workItem: item2 } = await projects.addWorkItem(project.id, { title: 'Review' });
      await projects.addWorkItem(project.id, { title: 'Inbox' });
      
      await queue.complete(item1.id, []);
      await queue.update(item2.id, { status: 'review' });
      
      const loaded = await projects.get(project.id);
      
      // 2 of 3 complete (done + review)
      expect(loaded.progress.percent).toBe(67); // Math.round(2/3 * 100)
    });
    
    it('should track in_flight separately', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const { workItem } = await projects.addWorkItem(project.id, { title: 'Working' });
      await queue.ready(workItem.id);
      await queue.claim('agent-1');
      
      const loaded = await projects.get(project.id);
      
      expect(loaded.progress.inFlight).toBe(1);
    });
    
    it('should track blocked separately', async () => {
      const project = await projects.create({ name: 'Test Project' });
      const { workItem } = await projects.addWorkItem(project.id, { title: 'Blocked' });
      await queue.update(workItem.id, { status: 'blocked' });
      
      const loaded = await projects.get(project.id);
      
      expect(loaded.progress.blocked).toBe(1);
    });
    
  });
  
});
