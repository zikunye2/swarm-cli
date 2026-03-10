/**
 * Claude provider implementation - SDK-based
 * 
 * Uses Anthropic SDK for both agent tasks and synthesis.
 * No more CLI spawning for agent tasks - full SDK control.
 * 
 * Supports:
 * - OAuth auth: Uses OAuth token from Claude CLI credentials (subscription users)
 * - API auth: Uses Anthropic SDK with ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
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
import { runAgentLoop } from '../agent-loop.js';

const CLAUDE_DEFINITION: ProviderDefinition = {
  name: 'claude',
  displayName: 'Claude',
  variants: [
    { id: 'opus', apiModel: 'claude-opus-4-20250514', displayName: 'Claude Opus' },
    { id: 'sonnet', apiModel: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet' },
    { id: 'haiku', apiModel: 'claude-3-5-haiku-latest', displayName: 'Claude Haiku' },
  ],
  authStrategies: [
    { type: 'api', envVar: 'ANTHROPIC_API_KEY' },
    { type: 'oauth' }, // OAuth from Claude CLI credentials
  ],
  defaultVariant: 'sonnet',
};

export class ClaudeProvider extends ModelProvider {
  readonly definition = CLAUDE_DEFINITION;
  private apiClient: Anthropic | null = null;
  private oauthClient: Anthropic | null = null;
  private oauthCredentials: Credentials | null = null;

  constructor(variant: string = 'sonnet', authType: AuthType = 'api', timeout?: number) {
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

    return false;
  }

  /**
   * Run as a coding agent using SDK with tool calling
   * 
   * This is the new SDK-based implementation that replaces CLI spawning.
   * The agent loop handles tool calling natively through the Anthropic SDK.
   */
  async runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const client = this.getClient();

    if (!client) {
      return this.createAgentResult(
        this.name,
        worktreePath,
        branchName,
        baseCommit,
        {
          output: '',
          error: 'No Claude credentials available. Set ANTHROPIC_API_KEY or authenticate with Claude CLI.',
          success: false,
          durationMs: Date.now() - startTime,
        }
      );
    }

    try {
      const result = await runAgentLoop({
        provider: 'claude',
        model: this.variant.apiModel || 'claude-sonnet-4-20250514',
        task,
        workdir: worktreePath,
        maxIterations: 30,
        verbose: false,
        claudeClient: client,
      });

      return this.createAgentResult(
        this.name,
        worktreePath,
        branchName,
        baseCommit,
        {
          output: result.output,
          error: result.error,
          success: result.success,
          durationMs: Date.now() - startTime,
        }
      );
    } catch (err: any) {
      return this.createAgentResult(
        this.name,
        worktreePath,
        branchName,
        baseCommit,
        {
          output: '',
          error: err.message || String(err),
          success: false,
          durationMs: Date.now() - startTime,
        }
      );
    }
  }

  /**
   * Run as synthesizer (for analyzing agent outputs)
   * 
   * Uses SDK for simple prompt → response (no tools needed).
   */
  async runAsSynthesizer(prompt: string): Promise<ModelResponse> {
    const client = this.getClient();
    
    if (!client) {
      throw new Error('No Claude credentials available. Set ANTHROPIC_API_KEY or authenticate with Claude CLI.');
    }

    const response = await client.messages.create({
      model: this.variant.apiModel || 'claude-sonnet-4-20250514',
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
}

// Register the Claude provider
ProviderRegistry.register(
  'claude',
  CLAUDE_DEFINITION,
  (variant, authType) => new ClaudeProvider(variant, authType)
);

export default ClaudeProvider;
