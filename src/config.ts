/**
 * Configuration management for swarm-cli
 * 
 * Loads and manages configuration from:
 * 1. ~/.swarm/config.json (user config)
 * 2. Environment variables
 * 3. CLI flags (highest priority)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SwarmConfig, DEFAULT_CONFIG, AuthType, ProviderConfig } from './models/types.js';

const CONFIG_DIR = join(homedir(), '.swarm');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Load configuration from file and environment
 */
export async function loadConfig(): Promise<SwarmConfig> {
  let fileConfig: Partial<SwarmConfig> = {};
  
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = await readFile(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(content);
    }
  } catch (err) {
    // Config file doesn't exist or is invalid, use defaults
  }
  
  // Merge with defaults
  const config: SwarmConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    providers: {
      ...DEFAULT_CONFIG.providers,
      ...(fileConfig.providers || {}),
    },
  };
  
  // Override auth type based on available API keys
  applyEnvironmentOverrides(config);
  
  return config;
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: SwarmConfig): Promise<void> {
  try {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }
    
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    throw new Error(`Failed to save config: ${(err as Error).message}`);
  }
}

/**
 * Get the effective auth type for a provider
 * Checks config, then falls back to environment detection
 */
export function getEffectiveAuth(
  config: SwarmConfig,
  providerName: string
): AuthType {
  const providerConfig = config.providers[providerName];
  
  if (providerConfig?.auth) {
    return providerConfig.auth;
  }
  
  // Auto-detect based on environment
  switch (providerName) {
    case 'claude':
      return process.env.ANTHROPIC_API_KEY ? 'api' : 'cli';
    case 'openai':
    case 'codex':
      return process.env.OPENAI_API_KEY ? 'api' : 'cli';
    case 'gemini':
      return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? 'api' : 'cli';
    default:
      return 'cli';
  }
}

/**
 * Apply environment variable overrides to config
 */
function applyEnvironmentOverrides(config: SwarmConfig): void {
  // SWARM_AGENTS env var overrides defaultAgents
  if (process.env.SWARM_AGENTS) {
    config.defaultAgents = process.env.SWARM_AGENTS.split(',').map(s => s.trim());
  }
  
  // SWARM_SYNTHESIZER env var overrides defaultSynthesizer
  if (process.env.SWARM_SYNTHESIZER) {
    config.defaultSynthesizer = process.env.SWARM_SYNTHESIZER;
  }
}

/**
 * Merge CLI options with config
 */
export function mergeWithCliOptions(
  config: SwarmConfig,
  cliOptions: {
    agents?: string[];
    synthesizer?: string;
  }
): SwarmConfig {
  return {
    ...config,
    defaultAgents: cliOptions.agents || config.defaultAgents,
    defaultSynthesizer: cliOptions.synthesizer || config.defaultSynthesizer,
  };
}

/**
 * Initialize config with defaults
 * Creates if doesn't exist, or shows current config
 */
export async function initConfig(): Promise<void> {
  if (existsSync(CONFIG_FILE)) {
    console.log(`Config already exists at ${CONFIG_FILE}`);
    console.log('\nCurrent configuration:');
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  
  await saveConfig(DEFAULT_CONFIG);
}

/**
 * Get config file path (for user info)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Validate model spec against available providers
 */
export function validateModelSpec(spec: string): { valid: boolean; error?: string } {
  const parts = spec.split(':');
  const provider = parts[0].toLowerCase();
  
  const validProviders = ['claude', 'openai', 'codex', 'gemini'];
  
  if (!validProviders.includes(provider)) {
    return {
      valid: false,
      error: `Unknown provider '${provider}'. Available: ${validProviders.join(', ')}`,
    };
  }
  
  // Validate variant if specified
  const variant = parts[1];
  if (variant) {
    const validVariants: Record<string, string[]> = {
      claude: ['opus', 'sonnet', 'haiku'],
      openai: ['o3', 'o4-mini', 'gpt-4.1', 'default'],
      codex: ['default'],
      gemini: ['pro', 'flash', 'default'],
    };
    
    if (validVariants[provider] && !validVariants[provider].includes(variant)) {
      return {
        valid: false,
        error: `Unknown variant '${variant}' for ${provider}. Available: ${validVariants[provider].join(', ')}`,
      };
    }
  }
  
  return { valid: true };
}

/**
 * Validate entire config structure
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }
  
  const cfg = config as Record<string, unknown>;
  
  // Validate defaultAgents
  if (cfg.defaultAgents !== undefined) {
    if (!Array.isArray(cfg.defaultAgents)) {
      errors.push('defaultAgents must be an array');
    } else {
      for (const agent of cfg.defaultAgents) {
        if (typeof agent !== 'string') {
          errors.push('Each agent in defaultAgents must be a string');
        } else {
          const validation = validateModelSpec(agent);
          if (!validation.valid) {
            errors.push(`Invalid agent "${agent}": ${validation.error}`);
          }
        }
      }
    }
  }
  
  // Validate defaultSynthesizer
  if (cfg.defaultSynthesizer !== undefined) {
    if (typeof cfg.defaultSynthesizer !== 'string') {
      errors.push('defaultSynthesizer must be a string');
    } else {
      const validation = validateModelSpec(cfg.defaultSynthesizer);
      if (!validation.valid) {
        errors.push(`Invalid synthesizer: ${validation.error}`);
      }
    }
  }
  
  // Validate providers
  if (cfg.providers !== undefined) {
    if (typeof cfg.providers !== 'object' || cfg.providers === null) {
      errors.push('providers must be an object');
    } else {
      const providers = cfg.providers as Record<string, unknown>;
      for (const [name, providerCfg] of Object.entries(providers)) {
        if (typeof providerCfg !== 'object' || providerCfg === null) {
          errors.push(`Provider ${name} config must be an object`);
          continue;
        }
        
        const pc = providerCfg as Record<string, unknown>;
        
        if (pc.auth !== undefined && pc.auth !== 'api' && pc.auth !== 'cli') {
          errors.push(`Provider ${name}: auth must be "api" or "cli"`);
        }
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}
