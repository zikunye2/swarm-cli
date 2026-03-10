/**
 * Claude provider implementation
 * 
 * Supports:
 * - OAuth auth: Uses OAuth token from Claude CLI credentials (for subscription users)
 * - API auth: Uses Anthropic SDK with ANTHROPIC_API_KEY
 * - CLI auth: Falls back to spawning `claude` CLI (legacy, may hang on M1)
 * 
 * For synthesis, ALWAYS uses SDK to avoid CLI hanging issues.
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
import {
  readClaudeCredentials,
  getAccessToken,
  isExpired,
  Credentials,
} from '../auth/index.js';

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
  private apiClient: Anthropic | null = null;
  private oauthClient: Anthropic | null = null;
  private oauthCredentials: Credentials | null = null;

  constructor(variant: string = 'sonnet', authType: AuthType = 'cli', timeout?: number) {
    super(variant, authType, timeout);
    this.initializeClients();
  }

  /**
   * Initialize API clients based on available credentials
   */
  private initializeClients(): void {
    // Try API key first
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        this.apiClient = new Anthropic();
      } catch {
        // Ignore initialization errors
      }
    }

    // Try OAuth credentials from Claude CLI
    this.oauthCredentials = readClaudeCredentials();
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      try {
        const token = getAccessToken(this.oauthCredentials);
        this.oauthClient = new Anthropic({
          apiKey: token,
        });
      } catch {
        // Ignore initialization errors
      }
    }
  }

  /**
   * Get the best available client (prefers OAuth for subscription users)
   */
  private getClient(): Anthropic | null {
    // Prefer OAuth client (subscription users)
    if (this.oauthClient && this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return this.oauthClient;
    }
    // Fall back to API key client
    return this.apiClient;
  }

  protected getDefinition(): ProviderDefinition {
    return CLAUDE_DEFINITION;
  }

  /**
   * Check if Claude is available with current auth method
   */
  async checkAvailable(): Promise<boolean> {
    // Check OAuth credentials first
    if (this.oauthClient && this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return true;
    }

    // Check API key
    if (this.apiClient && process.env.ANTHROPIC_API_KEY) {
      return true;
    }

    // Fall back to CLI check
    if (this.authType === 'cli') {
      return this.checkCliAvailable('claude');
    }

    return false;
  }

  /**
   * Run as a coding agent using CLI
   * 
   * Note: For agent tasks, we still use CLI because it has file editing tools,
   * bash access, etc. The SDK alone cannot perform coding tasks.
   */
  async runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const prompt = this.buildAgentPrompt(task);

    // Claude CLI is required for agent tasks (has tools, file access)
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
   * 
   * ALWAYS uses SDK to avoid CLI hanging issues on macOS M1.
   * This is just prompt → response, no tools required.
   */
  async runAsSynthesizer(prompt: string): Promise<ModelResponse> {
    // ALWAYS try SDK first - avoids CLI hanging issues
    const client = this.getClient();
    
    if (client) {
      return this.synthesizeViaApi(client, prompt);
    }

    // No SDK client available - last resort is CLI (may hang on M1)
    console.warn('[claude] No OAuth/API credentials found, falling back to CLI (may hang on M1 Macs)');
    return this.synthesizeViaCli(prompt);
  }

  /**
   * Synthesize using Anthropic API
   */
  private async synthesizeViaApi(client: Anthropic, prompt: string): Promise<ModelResponse> {
    const response = await client.messages.create({
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
   * Synthesize using Claude CLI (fallback, may hang on M1)
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
        reject(new Error('Claude CLI synthesis timed out (consider using OAuth or API key to avoid this issue)'));
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
