/**
 * Abstract base class for model providers - SDK-based
 * 
 * Each provider (Claude, OpenAI, Gemini) implements this interface
 * using their respective SDKs with tool calling.
 * 
 * No more CLI spawning - all providers use pure SDK.
 */

import { simpleGit } from 'simple-git';
import {
  AuthType,
  ModelSpec,
  ModelResponse,
  ProviderDefinition,
  ModelVariant,
  AgentResult,
} from './types.js';

/**
 * Abstract base class for all model providers
 */
export abstract class ModelProvider {
  protected authType: AuthType;
  protected variant: ModelVariant;
  protected timeout: number;

  constructor(variant: string, authType: AuthType, timeout: number = 300000) {
    this.authType = authType;
    this.variant = this.getVariantByIdOrDefault(variant);
    this.timeout = timeout;
  }

  // Provider definition (static info about the provider)
  abstract readonly definition: ProviderDefinition;

  // Get the unique identifier for this provider instance
  get name(): string {
    return `${this.definition.name}:${this.variant.id}`;
  }

  // Display name for UI
  get displayName(): string {
    return this.variant.displayName;
  }

  /**
   * Run as a coding agent in a worktree
   * Now uses SDK with tool calling instead of spawning CLI
   */
  abstract runAsAgent(
    task: string,
    worktreePath: string,
    branchName: string,
    baseCommit?: string
  ): Promise<AgentResult>;

  /**
   * Run as a synthesizer (for analyzing agent outputs)
   */
  abstract runAsSynthesizer(prompt: string): Promise<ModelResponse>;

  /**
   * Check if this provider is available with current auth
   */
  abstract checkAvailable(): Promise<boolean>;

  /**
   * Get variant by ID or fall back to default
   */
  protected getVariantByIdOrDefault(variantId: string): ModelVariant {
    const found = this.getDefinition().variants.find(v => v.id === variantId);
    if (found) return found;
    
    // Fall back to default
    const defaultId = this.getDefinition().defaultVariant;
    const defaultVariant = this.getDefinition().variants.find(v => v.id === defaultId);
    return defaultVariant || this.getDefinition().variants[0];
  }

  /**
   * Get definition - workaround for calling from constructor
   */
  protected abstract getDefinition(): ProviderDefinition;

  /**
   * Common agent execution logic - handles git operations
   */
  protected async createAgentResult(
    agentName: string,
    worktreePath: string,
    branchName: string,
    baseCommit: string | undefined,
    execResult: { output: string; error?: string; success: boolean; durationMs: number }
  ): Promise<AgentResult> {
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
        await git.commit(`Swarm (${agentName}): task completed`, { '--allow-empty': null });
      }

      // Get diff against base commit
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

    return {
      agentName,
      worktreePath,
      branchName,
      success: execResult.success,
      output: execResult.output,
      error: execResult.error,
      durationMs: execResult.durationMs,
      filesChanged,
      diff,
    };
  }
}

/**
 * Registry for model providers
 */
export class ProviderRegistry {
  private static providers: Map<string, () => ModelProvider> = new Map();
  private static definitions: Map<string, ProviderDefinition> = new Map();

  /**
   * Register a provider factory
   */
  static register(
    name: string,
    definition: ProviderDefinition,
    factory: (variant: string, authType: AuthType) => ModelProvider
  ): void {
    this.definitions.set(name.toLowerCase(), definition);
    this.providers.set(name.toLowerCase(), () => {
      // Return default instance for listing purposes
      return factory(definition.defaultVariant, definition.authStrategies[0].type);
    });
  }

  /**
   * Get a provider instance with specific variant and auth
   */
  static get(
    name: string,
    variant?: string,
    authType?: AuthType
  ): ModelProvider | undefined {
    const def = this.definitions.get(name.toLowerCase());
    if (!def) return undefined;

    const factory = this.providers.get(name.toLowerCase());
    if (!factory) return undefined;

    // Parse variant from name if not provided (e.g., "claude:opus")
    let providerName = name;
    let parsedVariant = variant || def.defaultVariant;
    
    if (name.includes(':')) {
      const parts = name.split(':');
      providerName = parts[0];
      parsedVariant = parts[1] || parsedVariant;
    }

    const actualAuthType = authType || def.authStrategies[0].type;
    
    // Re-get the definition with correct name
    const actualDef = this.definitions.get(providerName.toLowerCase());
    if (!actualDef) return undefined;

    // Get the registered factory and create with params
    const factoryFn = this.providers.get(providerName.toLowerCase());
    if (!factoryFn) return undefined;

    // We need to pass variant and auth to the actual factory
    // This is a bit hacky but works for our use case
    const instance = factoryFn();
    // Re-instantiate with correct params
    const Constructor = instance.constructor as new (variant: string, authType: AuthType, timeout?: number) => ModelProvider;
    return new Constructor(parsedVariant, actualAuthType);
  }

  /**
   * Get provider definition
   */
  static getDefinition(name: string): ProviderDefinition | undefined {
    return this.definitions.get(name.toLowerCase());
  }

  /**
   * List all registered providers
   */
  static list(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * List all available model specs (provider:variant combinations)
   */
  static listAllModels(): string[] {
    const models: string[] = [];
    for (const [name, def] of this.definitions) {
      for (const variant of def.variants) {
        models.push(`${name}:${variant.id}`);
      }
    }
    return models;
  }

  /**
   * Check if a provider exists
   */
  static has(name: string): boolean {
    const baseName = name.includes(':') ? name.split(':')[0] : name;
    return this.definitions.has(baseName.toLowerCase());
  }
}

/**
 * Parse a model specification string (e.g., "claude:opus" or just "claude")
 */
export function parseModelSpec(spec: string): ModelSpec {
  const parts = spec.split(':');
  return {
    provider: parts[0].toLowerCase(),
    variant: parts[1] || 'default', // Will be resolved to actual default later
  };
}
