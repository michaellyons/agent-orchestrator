/**
 * User Management & Credit Score Tests
 * 
 * Business Requirements:
 * - Users have accounting for task submissions, completions, artifacts
 * - Credit score computed from KPI performance
 * - Score tiers determine user standing
 * - Leaderboard ranks users by credit score
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as users from './index.js';

describe('User Management', () => {
  
  beforeEach(async () => {
    // Clear users before each test
    await users.saveUsers({ users: {} });
  });
  
  afterEach(async () => {
    await users.saveUsers({ users: {} });
  });
  
  // ============================================
  // USER CREATION
  // ============================================
  
  describe('getOrCreate()', () => {
    
    it('should create new user with default values', async () => {
      const user = await users.getOrCreate('user-1');
      
      expect(user.id).toBe('user-1');
      expect(user.creditScore.current).toBe(500);
      expect(user.creditScore.tier).toBe('bronze');
      expect(user.accounting.tasksSubmitted).toBe(0);
    });
    
    it('should return existing user without overwriting', async () => {
      const user1 = await users.getOrCreate('user-1');
      await users.recordTaskSubmitted('user-1');
      
      const user2 = await users.getOrCreate('user-1');
      
      expect(user2.accounting.tasksSubmitted).toBe(1);
    });
    
    it('should store metadata on creation', async () => {
      const user = await users.getOrCreate('user-1', { 
        name: 'Test User',
        email: 'test@example.com' 
      });
      
      expect(user.metadata.name).toBe('Test User');
    });
    
  });
  
  // ============================================
  // TASK ACCOUNTING
  // ============================================
  
  describe('task accounting', () => {
    
    it('should track task submissions', async () => {
      await users.getOrCreate('user-1');
      
      await users.recordTaskSubmitted('user-1');
      await users.recordTaskSubmitted('user-1');
      
      const user = await users.get('user-1');
      expect(user.accounting.tasksSubmitted).toBe(2);
    });
    
    it('should track task completions', async () => {
      await users.getOrCreate('user-1');
      await users.recordTaskSubmitted('user-1');
      
      await users.recordTaskCompleted('user-1', {
        executionTimeMs: 5000,
        complexity: 'medium',
      });
      
      const user = await users.get('user-1');
      expect(user.accounting.tasksCompleted).toBe(1);
    });
    
    it('should track abandoned tasks', async () => {
      await users.getOrCreate('user-1');
      await users.recordTaskSubmitted('user-1');
      
      await users.recordTaskAbandoned('user-1', 'timeout');
      
      const user = await users.get('user-1');
      expect(user.accounting.tasksAbandoned).toBe(1);
    });
    
    it('should accumulate execution time', async () => {
      await users.getOrCreate('user-1');
      
      await users.recordTaskCompleted('user-1', { executionTimeMs: 1000 });
      await users.recordTaskCompleted('user-1', { executionTimeMs: 2000 });
      
      const user = await users.get('user-1');
      expect(user.accounting.totalExecutionTimeMs).toBe(3000);
    });
    
  });
  
  // ============================================
  // CREDIT SCORE
  // ============================================
  
  describe('credit score', () => {
    
    it('should increase score on task completion', async () => {
      await users.getOrCreate('user-1');
      const before = 500;
      
      await users.recordTaskCompleted('user-1', {
        complexity: 'medium',
        success: true,
      });
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeGreaterThan(before);
    });
    
    it('should decrease score on task abandonment', async () => {
      await users.getOrCreate('user-1');
      const before = 500;
      
      await users.recordTaskAbandoned('user-1');
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeLessThan(before);
    });
    
    it('should give bonus for high complexity tasks', async () => {
      await users.getOrCreate('user-1');
      await users.getOrCreate('user-2');
      
      await users.recordTaskCompleted('user-1', { complexity: 'low' });
      await users.recordTaskCompleted('user-2', { complexity: 'critical' });
      
      const user1 = await users.get('user-1');
      const user2 = await users.get('user-2');
      
      expect(user2.creditScore.current).toBeGreaterThan(user1.creditScore.current);
    });
    
    it('should give efficiency bonus for fast completion', async () => {
      await users.getOrCreate('user-1');
      await users.getOrCreate('user-2');
      
      // User 1: Slow (took 2x the estimate)
      await users.recordTaskCompleted('user-1', {
        estimatedTimeMs: 5000,
        executionTimeMs: 10000,
      });
      
      // User 2: Fast (took half the estimate)
      await users.recordTaskCompleted('user-2', {
        estimatedTimeMs: 5000,
        executionTimeMs: 2500,
      });
      
      const user1 = await users.get('user-1');
      const user2 = await users.get('user-2');
      
      expect(user2.creditScore.current).toBeGreaterThan(user1.creditScore.current);
    });
    
    it('should track score history', async () => {
      await users.getOrCreate('user-1');
      
      await users.recordTaskCompleted('user-1', { complexity: 'medium' });
      await users.recordTaskAbandoned('user-1');
      
      const user = await users.get('user-1');
      expect(user.creditScore.history.length).toBe(2);
      expect(user.creditScore.history[0].reason).toBe('task_completed');
      expect(user.creditScore.history[1].reason).toBe('task_abandoned');
    });
    
    it('should respect score bounds [100, 900]', async () => {
      await users.getOrCreate('user-1');
      
      // Try to go below 100
      for (let i = 0; i < 50; i++) {
        await users.recordTaskAbandoned('user-1');
      }
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeGreaterThanOrEqual(100);
    });
    
  });
  
  // ============================================
  // ARTIFACT QUALITY
  // ============================================
  
  describe('artifact reviews', () => {
    
    it('should track accepted artifacts', async () => {
      await users.getOrCreate('user-1');
      
      await users.recordArtifactReview('user-1', true);
      await users.recordArtifactReview('user-1', true);
      
      const user = await users.get('user-1');
      expect(user.accounting.artifactsAccepted).toBe(2);
    });
    
    it('should track rejected artifacts', async () => {
      await users.getOrCreate('user-1');
      
      await users.recordArtifactReview('user-1', false);
      
      const user = await users.get('user-1');
      expect(user.accounting.artifactsRejected).toBe(1);
    });
    
    it('should increase score on artifact acceptance', async () => {
      await users.getOrCreate('user-1');
      const before = 500;
      
      await users.recordArtifactReview('user-1', true);
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeGreaterThan(before);
    });
    
    it('should decrease score on artifact rejection', async () => {
      await users.getOrCreate('user-1');
      const before = 500;
      
      await users.recordArtifactReview('user-1', false);
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeLessThan(before);
    });
    
  });
  
  // ============================================
  // TIERS
  // ============================================
  
  describe('tiers', () => {
    
    it('should start at bronze tier', async () => {
      const user = await users.getOrCreate('user-1');
      expect(user.creditScore.tier).toBe('bronze');
    });
    
    it('should upgrade to silver at 500+', async () => {
      await users.getOrCreate('user-1');
      
      // Complete enough tasks to reach 500+
      for (let i = 0; i < 5; i++) {
        await users.recordTaskCompleted('user-1', { complexity: 'high' });
      }
      
      const user = await users.get('user-1');
      expect(user.creditScore.current).toBeGreaterThanOrEqual(500);
      expect(['silver', 'gold', 'platinum']).toContain(user.creditScore.tier);
    });
    
  });
  
  // ============================================
  // LEADERBOARD
  // ============================================
  
  describe('leaderboard', () => {
    
    it('should rank users by credit score', async () => {
      await users.getOrCreate('user-1');
      await users.getOrCreate('user-2');
      await users.getOrCreate('user-3');
      
      // User 2 gets highest score
      await users.recordTaskCompleted('user-2', { complexity: 'critical' });
      await users.recordTaskCompleted('user-2', { complexity: 'critical' });
      
      // User 3 gets second
      await users.recordTaskCompleted('user-3', { complexity: 'medium' });
      
      // User 1 loses points
      await users.recordTaskAbandoned('user-1');
      
      const leaderboard = await users.getLeaderboard(10);
      
      expect(leaderboard[0].userId).toBe('user-2');
      expect(leaderboard[1].userId).toBe('user-3');
      expect(leaderboard[2].userId).toBe('user-1');
    });
    
    it('should limit results', async () => {
      for (let i = 0; i < 5; i++) {
        await users.getOrCreate(`user-${i}`);
      }
      
      const leaderboard = await users.getLeaderboard(3);
      expect(leaderboard.length).toBe(3);
    });
    
  });
  
  // ============================================
  // STATS
  // ============================================
  
  describe('getStats()', () => {
    
    it('should return comprehensive user stats', async () => {
      await users.getOrCreate('user-1');
      await users.recordTaskSubmitted('user-1');
      await users.recordTaskCompleted('user-1', {
        complexity: 'medium',
        tokensUsed: 1000,
      });
      
      const stats = await users.getStats('user-1');
      
      expect(stats.userId).toBe('user-1');
      expect(stats.creditScore).toBeDefined();
      expect(stats.tier).toBeDefined();
      expect(stats.tasksSubmitted).toBe(1);
      expect(stats.tasksCompleted).toBe(1);
      expect(stats.completionRate).toBe(100);
    });
    
    it('should return null for unknown user', async () => {
      const stats = await users.getStats('unknown');
      expect(stats).toBeNull();
    });
    
  });
  
});
