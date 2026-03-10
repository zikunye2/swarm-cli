/**
 * Git worktree management for parallel agent execution
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WorktreeInfo } from './types.js';

export class WorktreeManager {
  private git: SimpleGit;
  private repoPath: string;
  private worktrees: WorktreeInfo[] = [];

  constructor(repoPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Create a worktree for an agent
   */
  async createWorktree(agentName: string, baseBranch: string = 'main'): Promise<WorktreeInfo> {
    const timestamp = Date.now();
    const branchName = `swarm/${agentName}-${timestamp}`;
    const worktreePath = path.join(this.repoPath, '..', `.swarm-worktrees`, `${agentName}-${timestamp}`);

    // Ensure worktrees directory exists
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    // Get current HEAD if baseBranch doesn't exist
    let base = baseBranch;
    try {
      await this.git.revparse([baseBranch]);
    } catch {
      // If baseBranch doesn't exist, use HEAD
      base = 'HEAD';
    }

    // Create the worktree with a new branch
    await this.git.raw(['worktree', 'add', '-b', branchName, worktreePath, base]);

    const commit = await this.git.revparse(['HEAD']);

    const info: WorktreeInfo = {
      path: worktreePath,
      branch: branchName,
      commit: commit.trim(),
    };

    this.worktrees.push(info);
    return info;
  }

  /**
   * List all active worktrees
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: WorktreeInfo[] = [];
    
    const entries = result.split('\n\n').filter(Boolean);
    for (const entry of entries) {
      const lines = entry.split('\n');
      let worktreePath = '';
      let branch = '';
      let commit = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.slice(9);
        } else if (line.startsWith('branch ')) {
          branch = line.slice(7).replace('refs/heads/', '');
        } else if (line.startsWith('HEAD ')) {
          commit = line.slice(5);
        }
      }

      if (worktreePath && branch) {
        worktrees.push({ path: worktreePath, branch, commit });
      }
    }

    return worktrees;
  }

  /**
   * Get the diff for a worktree compared to base
   */
  async getWorktreeDiff(worktreePath: string, baseBranch: string = 'main'): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);
    
    try {
      // First, commit any changes in the worktree
      const status = await worktreeGit.status();
      if (status.files.length > 0) {
        await worktreeGit.add('.');
        await worktreeGit.commit('Swarm agent changes', { '--allow-empty': null });
      }

      // Get diff against base
      const diff = await worktreeGit.diff([baseBranch, 'HEAD']);
      return diff;
    } catch (error) {
      // If base branch doesn't exist, get diff against initial commit
      try {
        const diff = await worktreeGit.diff(['HEAD~1', 'HEAD']);
        return diff;
      } catch {
        return '';
      }
    }
  }

  /**
   * Get list of changed files in worktree
   */
  async getChangedFiles(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    const status = await worktreeGit.status();
    
    return [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map((r: { to: string }) => r.to),
    ];
  }

  /**
   * Cleanup a specific worktree
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    try {
      // Force remove the worktree
      await this.git.raw(['worktree', 'remove', '--force', worktreePath]);
    } catch {
      // If git worktree remove fails, try manual cleanup
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Remove from tracked list
    this.worktrees = this.worktrees.filter(w => w.path !== worktreePath);
  }

  /**
   * Cleanup all swarm worktrees
   */
  async cleanupAll(): Promise<void> {
    const allWorktrees = await this.listWorktrees();
    
    for (const worktree of allWorktrees) {
      if (worktree.branch.startsWith('swarm/')) {
        await this.removeWorktree(worktree.path);
        
        // Also delete the branch
        try {
          await this.git.branch(['-D', worktree.branch]);
        } catch {
          // Ignore if branch already deleted
        }
      }
    }

    // Prune worktree references
    await this.git.raw(['worktree', 'prune']);
  }

  /**
   * Get tracked worktrees from this session
   */
  getTrackedWorktrees(): WorktreeInfo[] {
    return [...this.worktrees];
  }
}
