/**
 * Tests for logging.ts
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeSwarmLog, createCommitMessage, SwarmLogEntry } from '../src/logging.js';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('writeSwarmLog', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-log-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  const createTestEntry = (): SwarmLogEntry => ({
    timestamp: new Date().toISOString(),
    task: 'Test task',
    repoPath: testDir,
    agents: ['claude:sonnet', 'gemini:pro'],
    synthesizer: 'claude:opus',
    duration: 5000,
    agentResults: [
      { name: 'claude:sonnet', success: true, filesChanged: 3 },
      { name: 'gemini:pro', success: false, filesChanged: 0 },
    ],
    conflicts: [
      { filePath: 'src/test.ts', severity: 'medium', type: 'different_changes' },
    ],
    decisions: [
      {
        filePath: 'src/test.ts',
        choice: 'a',
        agentName: 'claude:sonnet',
        timestamp: new Date().toISOString(),
      },
    ],
  });

  test('creates SWARM_LOG.md file', async () => {
    const entry = createTestEntry();
    await writeSwarmLog(testDir, entry);
    
    const logPath = join(testDir, 'SWARM_LOG.md');
    assert.ok(existsSync(logPath), 'Log file should be created');
  });

  test('includes task in log', async () => {
    const entry = createTestEntry();
    entry.task = 'Add unit tests for auth module';
    
    await writeSwarmLog(testDir, entry);
    
    const content = readFileSync(join(testDir, 'SWARM_LOG.md'), 'utf-8');
    assert.ok(content.includes('Add unit tests for auth module'));
  });

  test('includes agent results table', async () => {
    const entry = createTestEntry();
    await writeSwarmLog(testDir, entry);
    
    const content = readFileSync(join(testDir, 'SWARM_LOG.md'), 'utf-8');
    assert.ok(content.includes('Agent Results'));
    assert.ok(content.includes('claude:sonnet'));
    assert.ok(content.includes('gemini:pro'));
    assert.ok(content.includes('✅ Success'));
    assert.ok(content.includes('❌ Failed'));
  });

  test('includes conflicts section', async () => {
    const entry = createTestEntry();
    await writeSwarmLog(testDir, entry);
    
    const content = readFileSync(join(testDir, 'SWARM_LOG.md'), 'utf-8');
    assert.ok(content.includes('Conflicts'));
    assert.ok(content.includes('src/test.ts'));
    assert.ok(content.includes('Medium') || content.includes('🟡'));
  });

  test('includes decisions section', async () => {
    const entry = createTestEntry();
    await writeSwarmLog(testDir, entry);
    
    const content = readFileSync(join(testDir, 'SWARM_LOG.md'), 'utf-8');
    assert.ok(content.includes('Decisions'));
    assert.ok(content.includes('claude:sonnet'));
  });

  test('prepends to existing log', async () => {
    const entry1 = createTestEntry();
    entry1.task = 'First task';
    await writeSwarmLog(testDir, entry1);
    
    const entry2 = createTestEntry();
    entry2.task = 'Second task';
    await writeSwarmLog(testDir, entry2);
    
    const content = readFileSync(join(testDir, 'SWARM_LOG.md'), 'utf-8');
    
    // Second task should appear before first task (newest first)
    const firstIndex = content.indexOf('First task');
    const secondIndex = content.indexOf('Second task');
    assert.ok(secondIndex < firstIndex, 'Newer entries should appear first');
  });
});

describe('createCommitMessage', () => {
  test('creates basic commit message', () => {
    const message = createCommitMessage('Fix authentication bug', []);
    assert.ok(message.includes('Fix authentication bug'));
    assert.ok(message.includes('swarm:'));
  });

  test('includes agent name when provided', () => {
    const message = createCommitMessage('Add tests', [], 'claude:opus');
    assert.ok(message.includes('claude:opus'));
    assert.ok(message.includes('Apply'));
  });

  test('includes decisions in body', () => {
    const decisions = [
      {
        filePath: 'src/auth.ts',
        choice: 'a',
        agentName: 'claude:sonnet',
        timestamp: new Date().toISOString(),
      },
      {
        filePath: 'src/utils.ts',
        choice: 'b',
        agentName: 'gemini:pro',
        timestamp: new Date().toISOString(),
      },
    ];
    
    const message = createCommitMessage('Refactor auth', decisions);
    assert.ok(message.includes('src/auth.ts: claude:sonnet'));
    assert.ok(message.includes('src/utils.ts: gemini:pro'));
  });

  test('truncates long task descriptions', () => {
    const longTask = 'This is a very long task description that should be truncated because it exceeds the maximum length allowed for a commit message summary line';
    const message = createCommitMessage(longTask, []);
    
    const firstLine = message.split('\n')[0];
    assert.ok(firstLine.length <= 80, 'First line should be reasonable length');
    assert.ok(firstLine.includes('...'), 'Should include ellipsis');
  });
});
