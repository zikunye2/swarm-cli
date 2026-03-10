/**
 * Types for the flexible model/auth architecture
 * 
 * Supports multiple auth strategies per provider:
 * - API: Uses SDK with env var (e.g., ANTHROPIC_API_KEY)
 * - CLI: Spawns the provider's CLI tool (e.g., claude, gemini, codex)
 */

// Authentication strategies
export type AuthType = 'api' | 'cli';

export interface AuthStrategy {
  type: AuthType;
  // For API auth: the env var name (e.g., 'ANTHROPIC_API_KEY')
  envVar?: string;
  // For CLI auth: the command to run (e.g., 'claude')
  cliCommand?: string;
}

// Model variant (e.g., 'opus', 'sonnet' for Claude)
export interface ModelVariant {
  id: string;           // e.g., 'opus', 'sonnet', 'pro'
  apiModel?: string;    // e.g., 'claude-opus-4-20250514' for API calls
  displayName: string;  // e.g., 'Claude Opus'
}

// Provider definition
export interface ProviderDefinition {
  name: string;           // 'claude', 'openai', 'gemini'
  displayName: string;    // 'Claude', 'OpenAI', 'Gemini'
  variants: ModelVariant[];
  authStrategies: AuthStrategy[];
  defaultVariant: string; // e.g., 'sonnet'
}

// Parsed model specification (e.g., "claude:opus" -> { provider: 'claude', variant: 'opus' })
export interface ModelSpec {
  provider: string;
  variant: string;
}

// Config for a single provider in config file
export interface ProviderConfig {
  auth: AuthType;
  apiKey?: string | null;  // Env var name or null
  defaultVariant?: string;
}

// Main config file structure (~/.swarm/config.json)
export interface SwarmConfig {
  defaultAgents: string[];       // e.g., ['claude:sonnet', 'codex', 'gemini:pro']
  defaultSynthesizer: string;    // e.g., 'claude:sonnet'
  providers: Record<string, ProviderConfig>;
}

// Default configuration
export const DEFAULT_CONFIG: SwarmConfig = {
  defaultAgents: ['claude'],
  defaultSynthesizer: 'claude:sonnet',
  providers: {
    claude: {
      auth: 'cli',
      apiKey: 'ANTHROPIC_API_KEY',
      defaultVariant: 'sonnet',
    },
    openai: {
      auth: 'cli',
      apiKey: 'OPENAI_API_KEY',
      defaultVariant: 'default',
    },
    gemini: {
      auth: 'cli',
      apiKey: 'GEMINI_API_KEY',
      defaultVariant: 'pro',
    },
  },
};

// Result from a model invocation (for synthesis)
export interface ModelResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Agent execution result (already defined in types.ts, re-export for convenience)
export type { AgentResult, AgentConfig } from '../types.js';
