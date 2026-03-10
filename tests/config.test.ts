/**
 * Tests for config.ts
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { validateModelSpec, validateConfig } from '../src/config.js';

describe('validateModelSpec', () => {
  test('accepts valid provider', () => {
    const result = validateModelSpec('claude');
    assert.strictEqual(result.valid, true);
  });

  test('accepts valid provider:variant', () => {
    const result = validateModelSpec('claude:opus');
    assert.strictEqual(result.valid, true);
  });

  test('rejects unknown provider', () => {
    const result = validateModelSpec('unknownprovider');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('Unknown provider'));
  });

  test('rejects unknown variant', () => {
    const result = validateModelSpec('claude:unknownvariant');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('Unknown variant'));
  });

  test('accepts all known Claude variants', () => {
    for (const variant of ['opus', 'sonnet', 'haiku']) {
      const result = validateModelSpec(`claude:${variant}`);
      assert.strictEqual(result.valid, true, `claude:${variant} should be valid`);
    }
  });

  test('accepts all known Gemini variants', () => {
    for (const variant of ['pro', 'flash', 'default']) {
      const result = validateModelSpec(`gemini:${variant}`);
      assert.strictEqual(result.valid, true, `gemini:${variant} should be valid`);
    }
  });
});

describe('validateConfig', () => {
  test('accepts valid config', () => {
    const config = {
      defaultAgents: ['claude', 'gemini:pro'],
      defaultSynthesizer: 'claude:sonnet',
      providers: {
        claude: { auth: 'cli' },
        gemini: { auth: 'api' },
      },
    };
    const result = validateConfig(config);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('rejects non-object config', () => {
    const result = validateConfig(null);
    assert.strictEqual(result.valid, false);
  });

  test('rejects invalid agent in defaultAgents', () => {
    const config = {
      defaultAgents: ['invalid:agent'],
    };
    const result = validateConfig(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid agent')));
  });

  test('rejects invalid auth type', () => {
    const config = {
      providers: {
        claude: { auth: 'invalid' },
      },
    };
    const result = validateConfig(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must be "oauth", "api", or "cli"')));
  });

  test('accepts oauth auth type', () => {
    const config = {
      providers: {
        claude: { auth: 'oauth' },
      },
    };
    const result = validateConfig(config);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test('accepts empty config', () => {
    const result = validateConfig({});
    assert.strictEqual(result.valid, true);
  });
});
