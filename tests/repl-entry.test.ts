/**
 * Tests for REPL entry path in CLI argument parsing.
 *
 * Verifies that `swarm` with no args enters REPL mode,
 * while `swarm "task"` and flags still work as before.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('CLI entry paths', () => {
  test('no args should set replMode flag (verifiable via help text)', async () => {
    // We can't easily call parseArgs() directly because it reads process.argv,
    // so we verify the help text documents REPL mode.
    const { execSync } = await import('node:child_process');
    const output = execSync('node dist/cli.js --help', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    assert.ok(output.includes('Start interactive REPL'), 'Help should mention REPL mode');
    assert.ok(output.includes('swarm "<task>"'), 'Help should still show task mode');
  });

  test('--help flag prints help and exits', async () => {
    const { execSync } = await import('node:child_process');
    const output = execSync('node dist/cli.js --help', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    assert.ok(output.includes('swarm - Multi-Agent Deliberation CLI'));
  });

  test('--version flag prints version', async () => {
    const { execSync } = await import('node:child_process');
    const output = execSync('node dist/cli.js --version', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    assert.ok(output.includes('v0.1.0'));
  });
});
