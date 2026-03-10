/**
 * Gemini provider implementation
 * 
 * Supports:
 * - CLI auth: Uses `gemini` CLI (Google Gemini CLI for subscription users)
 * - API auth: Uses Google AI SDK with GEMINI_API_KEY
 */

import { spawn } from 'node:child_process';
import { ModelProvider, ProviderRegistry } from './provider.js';
import {
  AuthType,
  ProviderDefinition,
  ModelResponse,
  AgentResult,
} from './types.js';

const GEMINI_DEFINITION: ProviderDefinition = {
  name: 'gemini',
  displayName: 'Gemini',
  variants: [
    { id: 'pro', apiModel: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro' },
    { id: 'flash', apiModel: 'gemini-2.5-flash-preview-04-17', displayName: 'Gemini 2.5 Flash' },
    { id: 'default', apiModel: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Default)' },
  ],
  authStrategies: [
    { type: 'cli', cliCommand: 'gemini' },
    { type: 'api', envVar: 'GEMINI_API_KEY' },
  ],
  defaultVariant: 'default',
};

export class GeminiProvider extends ModelProvider {
  readonly definition = GEMINI_DEFINITION;

  constructor(variant: string = 'default', authType: AuthType = 'cli', timeout?: number) {
    super(variant, authType, timeout);
  }

  protected getDefinition(): ProviderDefinition {
    return GEMINI_DEFINITION;
  }

  /**
   * Check if Gemini is available
   */
  async checkAvailable(): Promise<boolean> {
    if (this.authType === 'api') {
      return !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY;
    } else {
      return this.checkCliAvailable('gemini');
    }
  }

  /**
   * Run as a coding agent using Gemini CLI
   */
  async runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const prompt = this.buildAgentPrompt(task);

    // Use Gemini CLI
    const { stdout, stderr, code } = await this.execCli(
      'gemini',
      ['--prompt', prompt, '--sandbox', 'false'],
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
   */
  async runAsSynthesizer(prompt: string): Promise<ModelResponse> {
    if (this.authType === 'api' && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
      return this.synthesizeViaApi(prompt);
    } else {
      return this.synthesizeViaCli(prompt);
    }
  }

  /**
   * Synthesize using Google AI API
   */
  private async synthesizeViaApi(prompt: string): Promise<ModelResponse> {
    // Dynamic import to avoid requiring @google/generative-ai if not using API
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: this.variant.apiModel || 'gemini-2.0-flash' });

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

  /**
   * Synthesize using Gemini CLI
   */
  private async synthesizeViaCli(prompt: string): Promise<ModelResponse> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      // Use gemini CLI with prompt flag
      const proc = spawn('gemini', ['--prompt', prompt], {
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
        reject(new Error('Gemini CLI synthesis timed out'));
      }, this.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ content: output.trim() });
        } else {
          reject(new Error(`Gemini CLI exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Gemini CLI: ${err.message}`));
      });
    });
  }
}

// Register Gemini provider
ProviderRegistry.register(
  'gemini',
  GEMINI_DEFINITION,
  (variant, authType) => new GeminiProvider(variant, authType)
);

export default GeminiProvider;
