/**
 * Tests for SlashCommandRegistry
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SlashCommandRegistry } from '../src/repl/SlashCommands.js';

function makeRegistry(): SlashCommandRegistry {
  const reg = new SlashCommandRegistry();
  reg.register('help', 'Show help', async () => 'help output');
  reg.register('quit', 'Exit', async () => 'bye');
  reg.register('models', 'List models', async () => 'model list');
  return reg;
}

describe('SlashCommandRegistry', () => {
  describe('parse', () => {
    test('detects slash command', () => {
      const reg = makeRegistry();
      const result = reg.parse('/help');
      assert.strictEqual(result.isSlash, true);
      assert.strictEqual(result.command, 'help');
      assert.strictEqual(result.args, '');
    });

    test('parses slash command with args', () => {
      const reg = makeRegistry();
      const result = reg.parse('/help some args');
      assert.strictEqual(result.isSlash, true);
      assert.strictEqual(result.command, 'help');
      assert.strictEqual(result.args, 'some args');
    });

    test('non-slash input', () => {
      const reg = makeRegistry();
      const result = reg.parse('add tests to the project');
      assert.strictEqual(result.isSlash, false);
      assert.strictEqual(result.command, undefined);
    });

    test('case insensitive command', () => {
      const reg = makeRegistry();
      const result = reg.parse('/HELP');
      assert.strictEqual(result.isSlash, true);
      assert.strictEqual(result.command, 'help');
    });
  });

  describe('execute', () => {
    test('runs registered command', async () => {
      const reg = makeRegistry();
      const output = await reg.execute('help', '');
      assert.strictEqual(output, 'help output');
    });

    test('returns error for unknown command', async () => {
      const reg = makeRegistry();
      const output = await reg.execute('unknown', '');
      assert.ok(output.includes('Unknown command'));
      assert.ok(output.includes('/unknown'));
    });
  });

  describe('complete', () => {
    test('returns matching commands', () => {
      const reg = makeRegistry();
      const results = reg.complete('h');
      assert.deepStrictEqual(results, ['/help']);
    });

    test('returns multiple matches', () => {
      const reg = makeRegistry();
      const results = reg.complete('');
      assert.strictEqual(results.length, 3);
    });

    test('returns empty for no match', () => {
      const reg = makeRegistry();
      const results = reg.complete('xyz');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('has', () => {
    test('returns true for registered command', () => {
      const reg = makeRegistry();
      assert.strictEqual(reg.has('help'), true);
    });

    test('returns false for unregistered command', () => {
      const reg = makeRegistry();
      assert.strictEqual(reg.has('unknown'), false);
    });
  });

  describe('getHelp', () => {
    test('returns formatted help lines', () => {
      const reg = makeRegistry();
      const lines = reg.getHelp();
      assert.strictEqual(lines.length, 3);
      assert.ok(lines[0].includes('/help'));
      assert.ok(lines[0].includes('Show help'));
    });
  });
});
