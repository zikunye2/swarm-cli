/**
 * Gemini provider implementation - SDK-based
 * 
 * Uses Google AI SDK for both agent tasks and synthesis.
 * No more CLI spawning for agent tasks - full SDK control.
 * 
 * Supports:
 * - OAuth auth: Uses OAuth token from Gemini CLI credentials (if available)
 * - API auth: Uses Google AI SDK with GEMINI_API_KEY or GOOGLE_API_KEY
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ModelProvider, ProviderRegistry } from './provider.js';
import {
  AuthType,
  ProviderDefinition,
  ModelResponse,
  AgentResult,
} from './types.js';
import {
  readGeminiCredentials,
  isExpired,
  Credentials,
  getAccessToken,
} from '../auth/index.js';
import { runAgentLoop } from '../agent-loop.js';

const GEMINI_DEFINITION: ProviderDefinition = {
  name: 'gemini',
  displayName: 'Gemini',
  variants: [
    { id: 'pro', apiModel: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro' },
    { id: 'flash', apiModel: 'gemini-2.5-flash-preview-04-17', displayName: 'Gemini 2.5 Flash' },
    { id: 'default', apiModel: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Default)' },
  ],
  authStrategies: [
    { type: 'api', envVar: 'GEMINI_API_KEY' },
    { type: 'oauth' }, // OAuth from Gemini CLI credentials (if available)
  ],
  defaultVariant: 'default',
};

export class GeminiProvider extends ModelProvider {
  readonly definition = GEMINI_DEFINITION;
  private oauthCredentials: Credentials | null = null;
  private apiKey: string | null = null;

  constructor(variant: string = 'default', authType: AuthType = 'api', timeout?: number) {
    super(variant, authType, timeout);
    this.initializeCredentials();
  }

  /**
   * Initialize credentials
   */
  private initializeCredentials(): void {
    // Try OAuth credentials from Gemini CLI
    this.oauthCredentials = readGeminiCredentials();
    
    // Try API key from environment
    this.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  }

  /**
   * Get the API key to use (OAuth token or env var)
   */
  private getApiKey(): string | null {
    // Prefer OAuth credentials
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return getAccessToken(this.oauthCredentials);
    }
    // Fall back to env var
    return this.apiKey;
  }

  /**
   * Get a configured Gemini client
   */
  private getClient(): GoogleGenerativeAI | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;
    return new GoogleGenerativeAI(apiKey);
  }

  protected getDefinition(): ProviderDefinition {
    return GEMINI_DEFINITION;
  }

  /**
   * Check if Gemini is available
   */
  async checkAvailable(): Promise<boolean> {
    // Check OAuth credentials first
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return true;
    }

    // Check API keys
    if (this.apiKey) {
      return true;
    }

    return false;
  }

  /**
   * Run as a coding agent using SDK with tool calling
   * 
   * This is the new SDK-based implementation that replaces CLI spawning.
   * The agent loop handles tool calling natively through the Google AI SDK.
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
          error: 'No Gemini credentials available. Set GEMINI_API_KEY or GOOGLE_API_KEY.',
          success: false,
          durationMs: Date.now() - startTime,
        }
      );
    }

    try {
      const result = await runAgentLoop({
        provider: 'gemini',
        model: this.variant.apiModel || 'gemini-2.0-flash',
        task,
        workdir: worktreePath,
        maxIterations: 30,
        verbose: false,
        geminiClient: client,
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
      throw new Error('No Gemini credentials available. Set GEMINI_API_KEY or GOOGLE_API_KEY.');
    }

    const model = client.getGenerativeModel({ 
      model: this.variant.apiModel || 'gemini-2.0-flash' 
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const content = response.text();

    return {
      content,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}

// Register Gemini provider
ProviderRegistry.register(
  'gemini',
  GEMINI_DEFINITION,
  (variant, authType) => new GeminiProvider(variant, authType)
);

export default GeminiProvider;
