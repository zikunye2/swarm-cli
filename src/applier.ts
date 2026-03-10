/**
 * Applier - Apply chosen agent changes to the main branch
 * 
 * Supports multiple methods:
 * 1. Cherry-pick commits from the agent's worktree branch
 * 2. Merge specific files from the worktree
 * 3. Full branch merge
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { AgentResult, WorktreeInfo } from './types.js';
import { WorktreeManager } from './worktree.js';

export type ApplyMethod = 'cherry-pick' | 'file-copy' | 'merge';

export interface ApplyOptions {
  method?: ApplyMethod;
  commit?: boolean;
  commitMessage?: string;
  cleanup?: boolean;
}

export interface ApplyResult {
  success: boolean;
  method: ApplyMethod;
  files: string[];
  error?: string;
  commitSha?: string;
}

export class Applier {
  private repoPath: string;
  private git: SimpleGit;
  private worktreeManager: WorktreeManager;

  constructor(repoPath: string, worktreeManager: WorktreeManager) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    this.worktreeManager = worktreeManager;
  }

  /**
   * Apply changes from a specific agent to the main branch
   */
  async applyAgent(
    agentResult: AgentResult,
    worktreeInfo: WorktreeInfo,
    options: ApplyOptions = {}
  ): Promise<ApplyResult> {
    const method = options.method || this.detectBestMethod(agentResult);

    try {
      switch (method) {
        case 'cherry-pick':
          return await this.cherryPickChanges(agentResult, worktreeInfo, options);
        case 'file-copy':
          return await this.copyFiles(agentResult, worktreeInfo, options);
        case 'merge':
          return await this.mergeBranch(agentResult, worktreeInfo, options);
        default:
          throw new Error(`Unknown apply method: ${method}`);
      }
    } catch (error) {
      return {
        success: false,
        method,
        files: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Apply changes for specific files only (for file-level decisions)
   */
  async applyFiles(
    files: string[],
    fromWorktreePath: string,
    options: ApplyOptions = {}
  ): Promise<ApplyResult> {
    const copiedFiles: string[] = [];

    try {
      for (const file of files) {
        const sourcePath = join(fromWorktreePath, file);
        const destPath = join(this.repoPath, file);

        // Check if source exists
        try {
          await fs.access(sourcePath);
        } catch {
          // File was deleted in worktree - delete in main too
          try {
            await fs.unlink(destPath);
            copiedFiles.push(file + ' (deleted)');
          } catch {
            // File doesn't exist in main either, skip
          }
          continue;
        }

        // Ensure destination directory exists
        await fs.mkdir(join(destPath, '..'), { recursive: true });

        // Copy file
        await fs.copyFile(sourcePath, destPath);
        copiedFiles.push(file);
      }

      // Commit if requested
      let commitSha: string | undefined;
      if (options.commit && copiedFiles.length > 0) {
        await this.git.add(files);
        const result = await this.git.commit(
          options.commitMessage || 'swarm: Apply selected changes'
        );
        commitSha = result.commit || undefined;
      }

      return {
        success: true,
        method: 'file-copy',
        files: copiedFiles,
        commitSha,
      };
    } catch (error) {
      return {
        success: false,
        method: 'file-copy',
        files: copiedFiles,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Detect best apply method based on the changes
   */
  private detectBestMethod(result: AgentResult): ApplyMethod {
    // If few files changed, file-copy is safer
    if (result.filesChanged.length <= 5) {
      return 'file-copy';
    }

    // If many files, cherry-pick preserves commit history better
    return 'cherry-pick';
  }

  /**
   * Cherry-pick the agent's commits to main
   */
  private async cherryPickChanges(
    result: AgentResult,
    worktreeInfo: WorktreeInfo,
    options: ApplyOptions
  ): Promise<ApplyResult> {
    // Get commits on the agent's branch since base
    const worktreeGit = simpleGit(worktreeInfo.path);
    
    // Find commits to cherry-pick
    const log = await worktreeGit.log({
      from: worktreeInfo.baseCommit || 'main',
      to: 'HEAD',
    });

    if (log.all.length === 0) {
      return {
        success: true,
        method: 'cherry-pick',
        files: [],
      };
    }

    // Cherry-pick each commit (oldest first)
    const commits = [...log.all].reverse();
    let lastCommitSha: string | undefined;

    try {
      for (const commit of commits) {
        await this.git.raw(['cherry-pick', commit.hash]);
        lastCommitSha = commit.hash;
      }

      return {
        success: true,
        method: 'cherry-pick',
        files: result.filesChanged,
        commitSha: lastCommitSha,
      };
    } catch (error) {
      // Cherry-pick failed, try to abort
      try {
        await this.git.raw(['cherry-pick', '--abort']);
      } catch {
        // Already aborted or not in cherry-pick
      }
      throw error;
    }
  }

  /**
   * Copy files directly from worktree
   */
  private async copyFiles(
    result: AgentResult,
    worktreeInfo: WorktreeInfo,
    options: ApplyOptions
  ): Promise<ApplyResult> {
    return this.applyFiles(result.filesChanged, worktreeInfo.path, options);
  }

  /**
   * Merge the agent's branch into main
   */
  private async mergeBranch(
    result: AgentResult,
    worktreeInfo: WorktreeInfo,
    options: ApplyOptions
  ): Promise<ApplyResult> {
    const message = options.commitMessage || 
      `swarm: Merge ${result.agentName} changes`;

    try {
      await this.git.merge([worktreeInfo.branch, '-m', message]);
      
      const head = await this.git.revparse(['HEAD']);
      
      return {
        success: true,
        method: 'merge',
        files: result.filesChanged,
        commitSha: head.trim(),
      };
    } catch (error) {
      // Merge failed, try to abort
      try {
        await this.git.merge(['--abort']);
      } catch {
        // Not in merge state
      }
      throw error;
    }
  }

  /**
   * Cleanup worktrees after applying
   */
  async cleanup(): Promise<void> {
    await this.worktreeManager.cleanupAll();
  }

  /**
   * Create an interactive apply session
   */
  async createApplySession(
    decisions: Map<string, { agentName: string; worktreePath: string }>
  ): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];

    // Group files by agent
    const filesByAgent = new Map<string, { worktreePath: string; files: string[] }>();
    
    for (const [filePath, decision] of decisions) {
      const existing = filesByAgent.get(decision.agentName);
      if (existing) {
        existing.files.push(filePath);
      } else {
        filesByAgent.set(decision.agentName, {
          worktreePath: decision.worktreePath,
          files: [filePath],
        });
      }
    }

    // Apply each agent's files
    for (const [agentName, { worktreePath, files }] of filesByAgent) {
      const result = await this.applyFiles(files, worktreePath, {
        commit: false, // We'll commit all at once
      });
      results.push({
        ...result,
        files: files.map(f => `${f} (from ${agentName})`),
      });
    }

    // Commit all changes together if any succeeded
    const allFiles = Array.from(decisions.keys());
    if (allFiles.length > 0) {
      try {
        await this.git.add(allFiles);
        await this.git.commit('swarm: Apply multi-agent decisions');
      } catch {
        // May fail if no changes to commit
      }
    }

    return results;
  }
}

export default Applier;
