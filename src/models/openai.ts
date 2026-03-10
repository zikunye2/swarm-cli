/**
 * OpenAI provider implementation
 * 
 * Supports:
 * - OAuth auth: Uses OAuth token from Codex CLI credentials (for subscription users)
 * - API auth: Uses OpenAI SDK with OPENAI_API_KEY
 * - CLI auth: Falls back to spawning `codex` CLI (legacy, may hang)
 * 
 * For synthesis, ALWAYS uses SDK to avoid CLI hanging issues.
 */

import { spawn } from 'node:child_process';
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
    { type: 'cli', cliCommand: 'codex' },
    { type: 'api', envVar: 'OPENAI_API_KEY' },
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
    { type: 'cli', cliCommand: 'codex' },
  ],
  defaultVariant: 'default',
};

export class OpenAIProvider extends ModelProvider {
  readonly definition: ProviderDefinition;
  private isCodexAlias: boolean;
  private oauthCredentials: OAuthCredentials | null = null;

  constructor(
    variant: string = 'default',
    authType: AuthType = 'cli',
    timeout?: number,
    isCodexAlias: boolean = false
  ) {
    super(variant, authType, timeout);
    this.isCodexAlias = isCodexAlias;
    this.definition = isCodexAlias ? CODEX_DEFINITION : OPENAI_DEFINITION;
    
    // Try to read OAuth credentials from Codex CLI
    this.oauthCredentials = readCodexCredentials();
  }

  protected getDefinition(): ProviderDefinition {
    return this.isCodexAlias ? CODEX_DEFINITION : OPENAI_DEFINITION;
  }

  /**
   * Check if OpenAI/Codex is available
   */
  async checkAvailable(): Promise<boolean> {
    // Check OAuth credentials first
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return true;
    }

    // Check API key
    if (process.env.OPENAI_API_KEY) {
      return true;
    }

    // Fall back to CLI check
    if (this.authType === 'cli') {
      return this.checkCliAvailable('codex');
    }

    return false;
  }

  /**
   * Run as a coding agent using Codex CLI
   */
  async runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const prompt = this.buildAgentPrompt(task);

    // Use Codex CLI for agent tasks (has tools, file access)
    const { stdout, stderr, code } = await this.execCli(
      'codex',
      ['--approval-mode', 'full-auto', '--quiet', prompt],
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
   * Run as synthesizer
   * 
   * ALWAYS uses SDK to avoid CLI hanging issues.
   */
  async runAsSynthesizer(prompt: string): Promise<ModelResponse> {
    // Try OAuth credentials first
    if (this.oauthCredentials && !isExpired(this.oauthCredentials)) {
      return this.synthesizeViaApi(prompt, this.oauthCredentials.access);
    }

    // Try API key
    if (process.env.OPENAI_API_KEY) {
      return this.synthesizeViaApi(prompt);
    }

    // No SDK credentials available - fall back to CLI (may hang)
    console.warn('[openai] No OAuth/API credentials found, falling back to CLI');
    return this.synthesizeViaCli(prompt);
  }

  /**
   * Synthesize using OpenAI API
   */
  private async synthesizeViaApi(prompt: string, oauthToken?: string): Promise<ModelResponse> {
    // Dynamic import to avoid requiring openai package if not using API
    const { default: OpenAI } = await import('openai');
    
    const client = oauthToken 
      ? new OpenAI({ apiKey: oauthToken })
      : new OpenAI();

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

  /**
   * Synthesize using Codex CLI (fallback)
   */
  private async synthesizeViaCli(prompt: string): Promise<ModelResponse> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      // Use codex in quiet mode for synthesis
      const proc = spawn('codex', ['--quiet', prompt], {
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
        reject(new Error('Codex CLI synthesis timed out'));
      }, this.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ content: output.trim() });
        } else {
          reject(new Error(`Codex CLI exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Codex CLI: ${err.message}`));
      });
    });
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
