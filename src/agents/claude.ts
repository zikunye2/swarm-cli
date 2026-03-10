/**
 * Claude Code CLI agent implementation
 */

import { spawn } from 'node:child_process';
import { Agent, BaseAgent, AgentRegistry } from './base.js';
import { AgentResult, AgentConfig } from '../types.js';
import { simpleGit } from 'simple-git';

export class ClaudeAgent extends BaseAgent implements Agent {
  readonly name = 'claude';
  readonly config: AgentConfig;

  constructor(timeout: number = 300000) { // 5 min default
    super();
    this.config = {
      name: 'claude',
      command: 'claude',
      args: ['-p', '--dangerously-skip-permissions'],
      timeout,
    };
  }

  /**
   * Check if Claude CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], {
        shell: true,
        stdio: 'pipe',
      });
      
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Execute Claude CLI with the given task
   */
  async execute(task: string, worktreePath: string, branchName: string): Promise<AgentResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      // Build the prompt with context
      const fullPrompt = this.buildPrompt(task);

      // Spawn Claude CLI
      const proc = spawn('claude', ['-p', fullPrompt, '--dangerously-skip-permissions'], {
        cwd: worktreePath,
        shell: true,
        stdio: 'pipe',
        env: {
          ...process.env,
          // Ensure Claude has access to necessary env vars
        },
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, this.config.timeout);

      proc.on('close', async (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        // Get changed files and diff
        const git = simpleGit(worktreePath);
        let filesChanged: string[] = [];
        let diff = '';

        try {
          const status = await git.status();
          filesChanged = [
            ...status.modified,
            ...status.created,
            ...status.deleted,
            ...status.renamed.map((r: { to: string }) => r.to),
          ];

          // Stage and commit changes if any
          if (filesChanged.length > 0) {
            await git.add('.');
            await git.commit(`Swarm: ${task.slice(0, 50)}...`, { '--allow-empty': null });
          }

          // Get the diff
          try {
            diff = await git.diff(['HEAD~1', 'HEAD']);
          } catch {
            diff = await git.diff(['HEAD']);
          }
        } catch (err) {
          // Git operations failed, continue with what we have
        }

        resolve(this.createResult(worktreePath, branchName, {
          success: code === 0,
          output: output.trim(),
          error: errorOutput.trim() || undefined,
          durationMs,
          filesChanged,
          diff,
        }));
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve(this.createResult(worktreePath, branchName, {
          success: false,
          output: '',
          error: err.message,
          durationMs: Date.now() - startTime,
        }));
      });
    });
  }

  /**
   * Build the full prompt for Claude
   */
  private buildPrompt(task: string): string {
    return `You are working on a coding task in a git worktree. Complete the following task:

TASK: ${task}

Instructions:
1. Analyze the codebase to understand the context
2. Make the necessary changes to complete the task
3. Ensure code quality and follow existing patterns
4. Do NOT commit - changes will be committed automatically

Focus on completing the task efficiently and correctly.`;
  }
}

// Register the Claude agent
AgentRegistry.register('claude', () => new ClaudeAgent());

export default ClaudeAgent;
