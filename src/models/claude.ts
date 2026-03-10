/**
 * Claude provider implementation
 * 
 * Supports:
 * - CLI auth: Uses `claude` CLI (for Claude Code / subscription users)
 * - API auth: Uses Anthropic SDK with ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { ModelProvider, ProviderRegistry } from './provider.js';
import {
  AuthType,
  ProviderDefinition,
  ModelResponse,
  AgentResult,
} from './types.js';

const CLAUDE_DEFINITION: ProviderDefinition = {
  name: 'claude',
  displayName: 'Claude',
  variants: [
    { id: 'opus', apiModel: 'claude-opus-4-20250514', displayName: 'Claude Opus' },
    { id: 'sonnet', apiModel: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet' },
    { id: 'haiku', apiModel: 'claude-3-5-haiku-latest', displayName: 'Claude Haiku' },
  ],
  authStrategies: [
    { type: 'cli', cliCommand: 'claude' },
    { type: 'api', envVar: 'ANTHROPIC_API_KEY' },
  ],
  defaultVariant: 'sonnet',
};

export class ClaudeProvider extends ModelProvider {
  readonly definition = CLAUDE_DEFINITION;
  private client: Anthropic | null = null;

  constructor(variant: string = 'sonnet', authType: AuthType = 'cli', timeout?: number) {
    super(variant, authType, timeout);
    
    // Initialize API client if using API auth
    if (this.authType === 'api' && process.env.ANTHROPIC_API_KEY) {
      try {
        this.client = new Anthropic();
      } catch (err) {
        // Will fall back to CLI
      }
    }
  }

  protected getDefinition(): ProviderDefinition {
    return CLAUDE_DEFINITION;
  }

  /**
   * Check if Claude is available with current auth method
   */
  async checkAvailable(): Promise<boolean> {
    if (this.authType === 'api') {
      return !!process.env.ANTHROPIC_API_KEY && this.client !== null;
    } else {
      return this.checkCliAvailable('claude');
    }
  }

  /**
   * Run as a coding agent using CLI
   */
  async runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const prompt = this.buildAgentPrompt(task);

    // Claude CLI is the primary way to run as agent
    // API mode is mainly for synthesis
    const { stdout, stderr, code } = await this.execCli(
      'claude',
      ['-p', prompt, '--dangerously-skip-permissions'],
      worktreePath
    );

    return this.createAgentResult(
      this.name,
      worktreePath,
      branchName,
      baseCommit,
      {
        output: stdout,
        error: stderr || undefined,
        success: code === 0,
        durationMs: Date.now() - startTime,
      }
    );
  }

  /**
   * Run as synthesizer (for analyzing agent outputs)
   */
  async runAsSynthesizer(prompt: string): Promise<ModelResponse> {
    if (this.authType === 'api' && this.client) {
      return this.synthesizeViaApi(prompt);
    } else {
      return this.synthesizeViaCli(prompt);
    }
  }

  /**
   * Synthesize using Anthropic API
   */
  private async synthesizeViaApi(prompt: string): Promise<ModelResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const response = await this.client.messages.create({
      model: this.variant.apiModel!,
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Synthesize using Claude CLI
   */
  private async synthesizeViaCli(prompt: string): Promise<ModelResponse> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      const proc = spawn('claude', ['-p', prompt], {
        stdio: 'pipe',
        env: process.env,
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Claude CLI synthesis timed out'));
      }, this.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ content: output.trim() });
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
      });
    });
  }
}

// Register the Claude provider
ProviderRegistry.register(
  'claude',
  CLAUDE_DEFINITION,
  (variant, authType) => new ClaudeProvider(variant, authType)
);

export default ClaudeProvider;
