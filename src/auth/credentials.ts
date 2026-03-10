/**
 * OAuth Credentials Reader
 * 
 * Reads OAuth credentials from CLI credential stores for each provider.
 * Based on OpenClaw's implementation for avoiding CLI hanging issues.
 * 
 * Priority:
 * 1. OAuth token from CLI credentials (subscription users)
 * 2. API key from environment variable (API users)
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ============================================================================
// Types
// ============================================================================

export interface OAuthCredentials {
  type: 'oauth';
  provider: string;
  access: string;
  refresh?: string;
  expires: number;
  accountId?: string;
}

export interface TokenCredentials {
  type: 'token';
  provider: string;
  token: string;
  expires?: number;
}

export type Credentials = OAuthCredentials | TokenCredentials;

// ============================================================================
// Claude Credentials
// ============================================================================

const CLAUDE_CLI_CREDENTIALS_PATH = '.claude/.credentials.json';
const CLAUDE_CLI_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const OPENCLAW_AUTH_PROFILES_PATH = '.openclaw/agents/main/agent/auth-profiles.json';

/**
 * Read Claude CLI credentials from macOS Keychain
 */
function readClaudeKeychainCredentials(): Credentials | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const result = execSync(
      `security find-generic-password -s "${CLAUDE_CLI_KEYCHAIN_SERVICE}" -w`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    const data = JSON.parse(result.trim());
    const claudeOauth = data?.claudeAiOauth;
    
    if (!claudeOauth || typeof claudeOauth !== 'object') {
      return null;
    }

    const accessToken = claudeOauth.accessToken;
    const refreshToken = claudeOauth.refreshToken;
    const expiresAt = claudeOauth.expiresAt;

    if (typeof accessToken !== 'string' || !accessToken) {
      return null;
    }

    if (typeof expiresAt !== 'number' || expiresAt <= 0) {
      return null;
    }

    if (typeof refreshToken === 'string' && refreshToken) {
      return {
        type: 'oauth',
        provider: 'anthropic',
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      };
    }

    return {
      type: 'token',
      provider: 'anthropic',
      token: accessToken,
      expires: expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Read Claude CLI credentials from file
 */
function readClaudeFileCredentials(): Credentials | null {
  const credPath = path.join(os.homedir(), CLAUDE_CLI_CREDENTIALS_PATH);
  
  try {
    if (!fs.existsSync(credPath)) {
      return null;
    }

    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const claudeOauth = raw?.claudeAiOauth;
    
    if (!claudeOauth || typeof claudeOauth !== 'object') {
      return null;
    }

    const accessToken = claudeOauth.accessToken;
    const refreshToken = claudeOauth.refreshToken;
    const expiresAt = claudeOauth.expiresAt;

    if (typeof accessToken !== 'string' || !accessToken) {
      return null;
    }

    if (typeof expiresAt !== 'number' || expiresAt <= 0) {
      return null;
    }

    if (typeof refreshToken === 'string' && refreshToken) {
      return {
        type: 'oauth',
        provider: 'anthropic',
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      };
    }

    return {
      type: 'token',
      provider: 'anthropic',
      token: accessToken,
      expires: expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Read Claude CLI credentials (keychain first, then file)
 */
/**
 * Read Claude credentials from OpenClaw auth profiles
 */
function readOpenClawAuthProfiles(): Credentials | null {
  try {
    const authPath = path.join(os.homedir(), OPENCLAW_AUTH_PROFILES_PATH);
    
    if (!fs.existsSync(authPath)) {
      return null;
    }

    const content = fs.readFileSync(authPath, 'utf-8');
    const data = JSON.parse(content);
    
    // Find an anthropic profile
    const profiles = data.profiles || {};
    for (const [profileId, profile] of Object.entries(profiles)) {
      const p = profile as any;
      if (p.provider === 'anthropic' && p.token) {
        return {
          type: 'token',
          provider: 'anthropic',
          token: p.token,
        };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export function readClaudeCredentials(): Credentials | null {
  // Try OpenClaw auth profiles first (most reliable)
  const openclawCreds = readOpenClawAuthProfiles();
  if (openclawCreds) {
    return openclawCreds;
  }

  // Try keychain (macOS)
  const keychainCreds = readClaudeKeychainCredentials();
  if (keychainCreds) {
    return keychainCreds;
  }

  // Fall back to file
  return readClaudeFileCredentials();
}

// ============================================================================
// Codex (OpenAI) Credentials
// ============================================================================

const CODEX_CLI_AUTH_FILENAME = 'auth.json';

function getCodexHomePath(): string {
  const configured = process.env.CODEX_HOME;
  const home = configured || path.join(os.homedir(), '.codex');
  
  try {
    return fs.realpathSync(home);
  } catch {
    return home;
  }
}

function computeCodexKeychainAccount(codexHome: string): string {
  const hash = createHash('sha256').update(codexHome).digest('hex');
  return `cli|${hash.slice(0, 16)}`;
}

/**
 * Read Codex CLI credentials from macOS Keychain
 */
function readCodexKeychainCredentials(): OAuthCredentials | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  const codexHome = getCodexHomePath();
  const account = computeCodexKeychainAccount(codexHome);

  try {
    const secret = execSync(
      `security find-generic-password -s "Codex Auth" -a "${account}" -w`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const parsed = JSON.parse(secret);
    const tokens = parsed.tokens;
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;

    if (typeof accessToken !== 'string' || !accessToken) {
      return null;
    }

    if (typeof refreshToken !== 'string' || !refreshToken) {
      return null;
    }

    // No explicit expiry stored; treat as fresh for an hour from last_refresh or now
    const lastRefreshRaw = parsed.last_refresh;
    const lastRefresh = typeof lastRefreshRaw === 'string' || typeof lastRefreshRaw === 'number'
      ? new Date(lastRefreshRaw).getTime()
      : Date.now();
    const expires = Number.isFinite(lastRefresh)
      ? lastRefresh + 60 * 60 * 1000
      : Date.now() + 60 * 60 * 1000;

    return {
      type: 'oauth',
      provider: 'openai-codex',
      access: accessToken,
      refresh: refreshToken,
      expires,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Read Codex CLI credentials from file
 */
function readCodexFileCredentials(): OAuthCredentials | null {
  const authPath = path.join(getCodexHomePath(), CODEX_CLI_AUTH_FILENAME);

  try {
    if (!fs.existsSync(authPath)) {
      return null;
    }

    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const tokens = raw?.tokens;

    if (!tokens || typeof tokens !== 'object') {
      return null;
    }

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (typeof accessToken !== 'string' || !accessToken) {
      return null;
    }

    if (typeof refreshToken !== 'string' || !refreshToken) {
      return null;
    }

    // Use file mtime + 1 hour as expiry estimate
    let expires: number;
    try {
      const stat = fs.statSync(authPath);
      expires = stat.mtimeMs + 60 * 60 * 1000;
    } catch {
      expires = Date.now() + 60 * 60 * 1000;
    }

    return {
      type: 'oauth',
      provider: 'openai-codex',
      access: accessToken,
      refresh: refreshToken,
      expires,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Read Codex CLI credentials (keychain first, then file)
 */
export function readCodexCredentials(): OAuthCredentials | null {
  // Try keychain first (macOS)
  const keychainCreds = readCodexKeychainCredentials();
  if (keychainCreds) {
    return keychainCreds;
  }

  // Fall back to file
  return readCodexFileCredentials();
}

// ============================================================================
// Gemini Credentials (placeholder - Gemini CLI may not have OAuth yet)
// ============================================================================

/**
 * Read Gemini CLI credentials
 * 
 * Note: Gemini CLI may not use OAuth tokens yet.
 * This is a placeholder for future implementation.
 */
export function readGeminiCredentials(): Credentials | null {
  // Check for potential credential locations
  const possiblePaths = [
    path.join(os.homedir(), '.config', 'gemini', 'credentials.json'),
    path.join(os.homedir(), '.gemini', 'credentials.json'),
    path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
  ];

  for (const credPath of possiblePaths) {
    try {
      if (!fs.existsSync(credPath)) {
        continue;
      }

      const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      
      // Try different credential formats
      const accessToken = raw.access_token || raw.accessToken;
      const refreshToken = raw.refresh_token || raw.refreshToken;
      const expiresAt = raw.expiry_date || raw.expiresAt || raw.expires_at;

      if (typeof accessToken !== 'string' || !accessToken) {
        continue;
      }

      return {
        type: 'oauth',
        provider: 'google-gemini',
        access: accessToken,
        refresh: typeof refreshToken === 'string' ? refreshToken : undefined,
        expires: typeof expiresAt === 'number' ? expiresAt : Date.now() + 3600000,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if credentials are expired (with 5 minute buffer)
 */
export function isExpired(creds: Credentials): boolean {
  const expiresAt = creds.type === 'oauth' ? creds.expires : creds.expires;
  if (!expiresAt) return false;
  
  // Consider expired if within 5 minutes of expiry
  const buffer = 5 * 60 * 1000;
  return Date.now() >= expiresAt - buffer;
}

/**
 * Get the access token from credentials
 */
export function getAccessToken(creds: Credentials): string {
  return creds.type === 'oauth' ? creds.access : creds.token;
}
