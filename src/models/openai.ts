/**
 * OpenAI provider implementation - SDK-based
 * 
 * Uses OpenAI SDK for both agent tasks and synthesis.
 * No more CLI spawning for agent tasks - full SDK control.
 * 
 * Supports:
 * - OAuth auth: Uses OAuth token from Codex CLI credentials (subscription users)
 * - API auth: Uses OpenAI SDK with OPENAI_API_KEY
 */

import OpenAI from 'openai';
import { ModelProvider, ProviderRegistry } from './provider.js';
import {
  AuthType,
  ProviderDefinition,
  ModelResponse,
  AgentResult,
} from './types.js';
import {
  readCodexCredentials,
  isExpired,
  OAuthCredentials,
} from '../auth/index.js';
import { runAgentLoop } from '../agent-loop.js';

const OPENAI_DEFINITION: ProviderDefinition = {
  name: 'openai',
  displayName: 'OpenAI',
  variants: [
    { id: 'o3', apiModel: 'o3', displayName: 'OpenAI o3' },
    { id: 'o4-mini', apiModel: 'o4-mini', displayName: 'OpenAI o4-mini' },
    { id: 'gpt-4.1', apiModel: 'gpt-4.1', displayName: 'GPT-4.1' },
    { id: 'default', apiModel: 'gpt-4o', displayName: 'GPT-4o (Default)' },
  ],
  authStrategies: [
    { type: 'api', envVar: 'OPENAI_API_KEY' },
    { type: 'oauth' }, // OAuth from Codex CLI credentials
  ],
  defaultVariant: 'default',
};

// Also register 'codex' as an alias for OpenAI
const CODEX_DEFINITION: ProviderDefinition = {
  name: 'codex',
  displayName: 'Codex (OpenAI)',
  variants: [
    { id: 'default', apiModel: 'gpt-4o', displayName: 'Codex Default' },
  ],
  authStrategies: [
    { type: 'api', envVar: 'OPENAI_API_KEY' },
    { type: 'oauth' },
  ],
  defaultVariant: 'default',
};

export class OpenAIProvider extends ModelProvider {
  readonly definition: ProviderDefinition;
  private isCodexAlias: boolean;
  private apiClient: OpenAI | null = null;
  private oauthClient: OpenAI | null = null;
  private oauthCredentials: OAuthCredentials | null = null;

  constructor(
    variant: string = 'default',
    authType: AuthType = 'api',
    timeout?: number,
    isCodexAlias: boolean = false
  ) {
    super(variant, authType, timeout);
    this.isCodexAlias = isCodexAlias;
    this.definition = isCodexAlias ? CODEX_DEFINITION : OPENAI_DEFINITION;
    this.initializeClients();
  }

  /**
   * Initialize API clients based on available credentials
   */
  private initializeClients(): void {
    // Try API key first
    if (process.env.OPENAI_API_KEY) {
      try {
        this.apiClient = new OpenAI();
      } catch {
        // Ignore initialization errors
      }
    }

    // Try OAuth credentials from Codex CLI
    this.oauthCredentials = readCodexCredentials();
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      try {
        this.oauthClient = new OpenAI({
          apiKey: this.oauthCredentials.access,
        });
      } catch {
        // Ignore initialization errors
      }
    }
  }

  /**
   * Get the best available client (prefers OAuth for subscription users)
   */
  private getClient(): OpenAI | null {
    // Prefer OAuth client (subscription users)
    if (this.oauthClient && this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return this.oauthClient;
    }
    // Fall back to API key client
    return this.apiClient;
  }

  protected getDefinition(): ProviderDefinition {
    return this.isCodexAlias ? CODEX_DEFINITION : OPENAI_DEFINITION;
  }

  /**
   * Check if OpenAI/Codex is available
   */
  async checkAvailable(): Promise<boolean> {
    // Check OAuth credentials first
    if (this.oauthClient && this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return true;
    }

    // Check API key
    if (this.apiClient && process.env.OPENAI_API_KEY) {
      return true;
    }

    return false;
  }

  /**
   * Run as a coding agent using SDK with tool calling
   * 
   * This is the new SDK-based implementation that replaces CLI spawning.
   * The agent loop handles tool calling natively through the OpenAI SDK.
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
          error: 'No OpenAI credentials available. Set OPENAI_API_KEY or authenticate with Codex CLI.',
          success: false,
          durationMs: Date.now() - startTime,
        }
      );
    }

    try {
      const result = await runAgentLoop({
        provider: 'openai',
        model: this.variant.apiModel || 'gpt-4o',
        task,
        workdir: worktreePath,
        maxIterations: 30,
        verbose: false,
        openaiClient: client,
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
      throw new Error('No OpenAI credentials available. Set OPENAI_API_KEY or authenticate with Codex CLI.');
    }

    const response = await client.chat.completions.create({
      model: this.variant.apiModel || 'gpt-4o',
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content || '';

    return {
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

// Register OpenAI provider
ProviderRegistry.register(
  'openai',
  OPENAI_DEFINITION,
  (variant, authType) => new OpenAIProvider(variant, authType)
);

// Register Codex as an alias
ProviderRegistry.register(
  'codex',
  CODEX_DEFINITION,
  (variant, authType) => new OpenAIProvider(variant, authType, undefined, true)
);

export default OpenAIProvider;
