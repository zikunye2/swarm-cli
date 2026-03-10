/**
 * Tests for worktree.ts
 * 
 * Note: These tests require a git repository to be available.
 * They create and cleanup test worktrees.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { WorktreeManager } from '../src/worktree.js';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { tmpdir } from 'node:os';

// Test helpers
async function createTestRepo(): Promise<string> {
  const testDir = join(tmpdir(), `swarm-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  
  const git = simpleGit(testDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  
  // Create initial commit
  writeFileSync(join(testDir, 'README.md'), '# Test Repo');
  await git.add('.');
  await git.commit('Initial commit');
  
  return testDir;
}

async function cleanupTestRepo(testDir: string): Promise<void> {
  try {
    rmSync(testDir, { recursive: true, force: true });
    // Also cleanup any worktrees that might have been created
    const worktreeDir = join(testDir, '..', '.swarm-worktrees');
    if (existsSync(worktreeDir)) {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

describe('WorktreeManager', () => {
  let testRepo: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    testRepo = await createTestRepo();
    manager = new WorktreeManager(testRepo);
  });

  afterEach(async () => {
    // Cleanup worktrees first
    try {
      await manager.cleanupAll();
    } catch {
      // Ignore
    }
    await cleanupTestRepo(testRepo);
  });

  test('creates worktree successfully', async () => {
    const info = await manager.createWorktree('test-agent', 'HEAD');
    
    assert.ok(info.path, 'Worktree path should be set');
    assert.ok(info.branch.includes('swarm/test-agent'), 'Branch should include agent name');
    assert.ok(info.commit, 'Commit SHA should be set');
    assert.ok(info.baseCommit, 'Base commit should be set');
    assert.ok(existsSync(info.path), 'Worktree directory should exist');
  });

  test('tracks created worktrees', async () => {
    await manager.createWorktree('agent1', 'HEAD');
    await manager.createWorktree('agent2', 'HEAD');
    
    const tracked = manager.getTrackedWorktrees();
    assert.strictEqual(tracked.length, 2);
  });

  test('removes worktree successfully', async () => {
    const info = await manager.createWorktree('to-remove', 'HEAD');
    assert.ok(existsSync(info.path));
    
    await manager.removeWorktree(info.path);
    
    // Path may still exist briefly, but tracked list should be empty
    const tracked = manager.getTrackedWorktrees();
    assert.strictEqual(tracked.length, 0);
  });

  test('lists all worktrees', async () => {
    await manager.createWorktree('list-test', 'HEAD');
    
    const all = await manager.listWorktrees();
    // Should include main repo + our worktree
    assert.ok(all.length >= 1);
    assert.ok(all.some(w => w.branch.includes('swarm/list-test')));
  });

  test('cleans up all swarm worktrees', async () => {
    await manager.createWorktree('cleanup1', 'HEAD');
    await manager.createWorktree('cleanup2', 'HEAD');
    
    let tracked = manager.getTrackedWorktrees();
    assert.strictEqual(tracked.length, 2);
    
    await manager.cleanupAll();
    
    tracked = manager.getTrackedWorktrees();
    // Tracked list should be empty after cleanup
    assert.strictEqual(tracked.length, 0);
  });

  test('generates unique branch names', async () => {
    const info1 = await manager.createWorktree('unique', 'HEAD');
    const info2 = await manager.createWorktree('unique', 'HEAD');
    
    assert.notStrictEqual(info1.branch, info2.branch);
    assert.notStrictEqual(info1.path, info2.path);
  });
});
