/**
 * Gemini CLI agent implementation
 */

import { spawn } from 'node:child_process';
import { Agent, BaseAgent, AgentRegistry } from './base.js';
import { AgentResult, AgentConfig } from '../types.js';
import { simpleGit } from 'simple-git';

export class GeminiAgent extends BaseAgent implements Agent {
  readonly name = 'gemini';
  readonly config: AgentConfig;

  constructor(timeout: number = 300000) { // 5 min default
    super();
    this.config = {
      name: 'gemini',
      command: 'gemini',
      args: ['--prompt'],
      timeout,
    };
  }

  /**
   * Check if Gemini CLI is installed
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      // No shell: true - prevent injection
      const proc = spawn('gemini', ['--version'], {
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
   * Execute Gemini CLI with the given task
   * @param baseCommit - The commit SHA to diff against (before agent changes)
   */
  async execute(task: string, worktreePath: string, branchName: string, baseCommit?: string): Promise<AgentResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      // Build the prompt with context
      const fullPrompt = this.buildPrompt(task);

      // Spawn Gemini CLI with --prompt flag for non-interactive mode - NO shell: true
      // Gemini CLI uses: gemini --prompt "prompt"
      const proc = spawn('gemini', [
        '--prompt', fullPrompt,
        '--sandbox', 'false',  // Allow file system access
      ], {
        cwd: worktreePath,
        stdio: 'pipe',
        env: {
          ...process.env,
          // Gemini may need GOOGLE_API_KEY or GEMINI_API_KEY
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
            await git.commit(`Swarm (Gemini): ${task.slice(0, 50)}...`, { '--allow-empty': null });
          }

          // Get the diff against the base commit (stored when worktree was created)
          if (baseCommit) {
            diff = await git.diff([baseCommit, 'HEAD']);
          } else {
            try {
              diff = await git.diff(['main', 'HEAD']);
            } catch {
              try {
                diff = await git.diff(['master', 'HEAD']);
              } catch {
                diff = await git.diff(['HEAD']);
              }
            }
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
   * Build the full prompt for Gemini
   */
  private buildPrompt(task: string): string {
    return `You are working on a coding task in a git repository. Complete the following task:

TASK: ${task}

Instructions:
1. Analyze the codebase to understand the context
2. Make the necessary changes to complete the task
3. Ensure code quality and follow existing patterns
4. Do NOT commit - changes will be committed automatically

Focus on completing the task efficiently and correctly.`;
  }
}

// Register the Gemini agent
AgentRegistry.register('gemini', () => new GeminiAgent());

export default GeminiAgent;
