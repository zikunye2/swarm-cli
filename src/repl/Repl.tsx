/**
 * Root REPL component — manages the full interactive lifecycle.
 *
 * States: setup → idle ⇄ executing → idle
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ReplPrompt } from './ReplPrompt.js';
import { TaskRunner } from './TaskRunner.js';
import { SetupWizard } from './SetupWizard.js';
import { SlashCommandRegistry } from './SlashCommands.js';
import { detectAvailableAgents } from './AgentDetector.js';
import { configExists, isConfigComplete, loadConfig } from '../config.js';
import { listAllModels } from '../models/index.js';
import type { ReplState } from '../types.js';

export interface ReplProps {
  verbose?: boolean;
}

function createSlashCommands(
  exit: () => void,
  triggerSetup: () => void,
): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();

  registry.register('help', 'Show available commands', async () => {
    const lines = [
      '',
      '  Commands:',
      ...registry.getHelp(),
      '',
      '  Or type a task in natural language to run agents.',
      '',
    ];
    return lines.join('\n');
  });

  registry.register('models', 'List available models', async () => {
    const models = listAllModels();
    return '\n  Available models:\n' + models.map((m) => `    ${m}`).join('\n') + '\n';
  });

  registry.register('agents', 'Show detected agent status', async () => {
    const detected = await detectAvailableAgents();
    const lines = ['\n  Agent status:'];
    for (const a of detected.available) {
      lines.push(`    ✓ ${a.displayName} (${a.authType}) — ${a.variants.join(', ')}`);
    }
    for (const a of detected.unavailable) {
      lines.push(`    ✗ ${a.displayName} — not configured`);
    }
    lines.push('');
    return lines.join('\n');
  });

  registry.register('config', 'Show current configuration', async () => {
    const config = await loadConfig();
    return (
      '\n  Current config:\n' +
      JSON.stringify(config, null, 2)
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n') +
      '\n'
    );
  });

  registry.register('setup', 'Re-run the setup wizard', async () => {
    triggerSetup();
    return '';
  });

  registry.register('quit', 'Exit swarm', async () => {
    exit();
    return '';
  });

  registry.register('exit', 'Exit swarm', async () => {
    exit();
    return '';
  });

  return registry;
}

export function Repl({ verbose = false }: ReplProps) {
  const { exit } = useApp();

  const [state, setState] = useState<ReplState>('idle');
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [commandOutput, setCommandOutput] = useState<string | null>(null);
  const [sessionTasks, setSessionTasks] = useState(0);
  const [sessionStart] = useState(Date.now());
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(true);

  const triggerSetup = useCallback(() => {
    setCommandOutput(null);
    setState('setup');
  }, []);

  const slashCommands = React.useMemo(
    () => createSlashCommands(exit, triggerSetup),
    [exit, triggerSetup],
  );

  // Check config on mount
  useEffect(() => {
    (async () => {
      if (!configExists()) {
        setState('setup');
        setNeedsSetup(true);
      } else {
        const config = await loadConfig();
        if (!isConfigComplete(config)) {
          setState('setup');
          setNeedsSetup(true);
        }
      }
      setCheckingConfig(false);
    })();
  }, []);

  // Handle prompt submission
  const handleSubmit = useCallback(
    async (input: string) => {
      setCommandOutput(null);

      const parsed = slashCommands.parse(input);
      if (parsed.isSlash && parsed.command) {
        const output = await slashCommands.execute(parsed.command, parsed.args || '');
        if (output) setCommandOutput(output);
        setHistory((h) => [...h, input]);
        return;
      }

      // It's a task
      setCurrentTask(input);
      setState('executing');
      setHistory((h) => [...h, input]);
    },
    [slashCommands],
  );

  // When task execution finishes
  const handleTaskComplete = useCallback(() => {
    setState('idle');
    setCurrentTask(null);
    setSessionTasks((n) => n + 1);
  }, []);

  // Ctrl+C in idle → print summary and exit
  useInput(
    (_ch, key) => {
      if (key.ctrl && _ch === 'c' && state === 'idle') {
        const dur = Math.round((Date.now() - sessionStart) / 1000);
        const mins = Math.floor(dur / 60);
        const secs = dur % 60;
        console.log(`\n  Session: ${sessionTasks} task(s), ${mins}m ${secs}s\n`);
        exit();
      }
    },
    { isActive: state === 'idle' },
  );

  // --- Render ---

  if (checkingConfig) {
    return null; // brief flash while checking
  }

  // Setup wizard
  if (state === 'setup') {
    return (
      <SetupWizard
        onComplete={() => {
          setState('idle');
          setNeedsSetup(false);
          setCommandOutput('\n  Setup complete! Type a task or /help to get started.\n');
        }}
        onSkip={() => {
          setState('idle');
          setNeedsSetup(false);
          setCommandOutput(
            '\n  Setup skipped. Make sure you have at least one API key set.\n' +
            '  Run /setup anytime to configure providers.\n',
          );
        }}
      />
    );
  }

  // Task execution
  if (state === 'executing' && currentTask) {
    return (
      <TaskRunner
        task={currentTask}
        onComplete={handleTaskComplete}
        verbose={verbose}
      />
    );
  }

  // Idle — prompt
  return (
    <Box flexDirection="column">
      {commandOutput && (
        <Box marginBottom={1}>
          <Text>{commandOutput}</Text>
        </Box>
      )}

      <ReplPrompt
        onSubmit={handleSubmit}
        history={history}
        hint={
          sessionTasks === 0
            ? 'Type a task, e.g. "add input validation to forms", or /help'
            : 'Enter another task, or /quit to exit'
        }
      />
    </Box>
  );
}
