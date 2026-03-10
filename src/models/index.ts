/**
 * Models module - flexible model/auth architecture
 * 
 * Exports all providers and utilities for working with
 * multiple AI models with different auth strategies.
 */

// Types
export * from './types.js';

// Base provider class and registry
export { ModelProvider, ProviderRegistry, parseModelSpec } from './provider.js';

// Concrete providers (registering happens on import)
export { ClaudeProvider } from './claude.js';
export { OpenAIProvider } from './openai.js';
export { GeminiProvider } from './gemini.js';

// Re-export for convenience
import { ProviderRegistry } from './provider.js';
import type { AuthType, ModelSpec, SwarmConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// Ensure all providers are registered
import './claude.js';
import './openai.js';
import './gemini.js';

/**
 * Get a provider by model spec string (e.g., "claude:opus", "gemini:pro", "codex")
 */
export function getProvider(spec: string, authType?: AuthType) {
  const parts = spec.split(':');
  const providerName = parts[0];
  const variant = parts[1] || undefined;
  
  return ProviderRegistry.get(providerName, variant, authType);
}

/**
 * Get all available providers that are ready to use
 */
export async function getAvailableProviders(): Promise<string[]> {
  const available: string[] = [];
  
  for (const name of ProviderRegistry.list()) {
    const provider = ProviderRegistry.get(name);
    if (provider && await provider.checkAvailable()) {
      available.push(name);
    }
  }
  
  return available;
}

/**
 * List all registered models with their variants
 */
export function listAllModels(): string[] {
  return ProviderRegistry.listAllModels();
}

/**
 * Check if a model spec is valid
 */
export function isValidModelSpec(spec: string): boolean {
  const parts = spec.split(':');
  const providerName = parts[0];
  return ProviderRegistry.has(providerName);
}
