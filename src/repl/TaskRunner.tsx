/**
 * TaskRunner bridges the REPL prompt with the existing App execution UI.
 *
 * Flow:
 *  1. Detect available agents → show suggestion
 *  2. Wait for user confirmation (Enter) or custom agent input
 *  3. Delegate to the existing App component
 *  4. On completion call onComplete() to return to the REPL prompt
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { detectAvailableAgents } from './AgentDetector.js';
import { App } from '../ui/App.js';
import { Orchestrator } from '../orchestrator.js';
import { Synthesizer } from '../synthesizer.js';
import { loadConfig } from '../config.js';
import { Decision } from '../ui/DecisionPanel.js';
import type { AgentResult, SynthesisResult, ProviderStatus } from '../types.js';

type Phase = 'detecting' | 'confirming' | 'running' | 'done';

export interface TaskRunnerProps {
  task: string;
  onComplete: () => void;
  verbose?: boolean;
}

export function TaskRunner({ task, onComplete, verbose = false }: TaskRunnerProps) {
  const [phase, setPhase] = useState<Phase>('detecting');
  const [agents, setAgents] = useState<string[]>([]);
  const [available, setAvailable] = useState<ProviderStatus[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [orchestrator, setOrchestrator] = useState<Orchestrator | null>(null);
  const [synthesizer, setSynthesizer] = useState<Synthesizer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: detect available agents
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detected = await detectAvailableAgents();
        if (cancelled) return;

        setAvailable(detected.available);

        const config = await loadConfig();
        // Pick defaults from config, filtered to available ones
        const availableNames = new Set(detected.available.map((a) => a.name));
        const defaults = config.defaultAgents.filter((a) => {
          const provider = a.split(':')[0];
          return availableNames.has(provider);
        });

        if (defaults.length === 0 && detected.available.length > 0) {
          // Fall back to first available
          setAgents([detected.available[0].name]);
        } else {
          setAgents(defaults);
        }

        setPhase('confirming');
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Handle confirmation input
  useInput(
    (ch, key) => {
      if (phase !== 'confirming') return;

      if (key.return) {
        if (customInput.trim()) {
          // User typed custom agents
          setAgents(customInput.trim().split(/[,\s]+/));
        }
        startExecution();
        return;
      }

      if (key.backspace || key.delete) {
        setCustomInput((prev) => prev.slice(0, -1));
        return;
      }

      // Escape -> cancel
      if (key.escape) {
        onComplete();
        return;
      }

      if (ch && !key.ctrl && !key.meta) {
        setCustomInput((prev) => prev + ch);
      }
    },
    { isActive: phase === 'confirming' },
  );

  const startExecution = useCallback(async () => {
    setPhase('running');
    try {
      const config = await loadConfig();
      const orch = new Orchestrator({ repoPath: '.', verbose });
      await orch.addAgents(agents);
      setOrchestrator(orch);

      const synth = new Synthesizer({
        model: config.defaultSynthesizer,
        verbose,
      });
      setSynthesizer(synth);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agents, verbose]);

  // --- Render ---

  if (error) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="red" bold>Error: {error}</Text>
        <Text dimColor>Press any key to return to prompt</Text>
      </Box>
    );
  }

  if (phase === 'detecting') {
    return (
      <Box paddingY={1}>
        <Text color="cyan">
          <Spinner type="dots" />{' '}
        </Text>
        <Text>Detecting available agents...</Text>
      </Box>
    );
  }

  if (phase === 'confirming') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text dimColor>Task: </Text>
          <Text>{task}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Agents: </Text>
          <Text color="cyan" bold>{agents.join(', ')}</Text>
          {available.length > agents.length && (
            <Text dimColor>  (available: {available.map((a) => a.name).join(', ')})</Text>
          )}
        </Box>

        {customInput.length > 0 ? (
          <Box>
            <Text dimColor>Custom agents: </Text>
            <Text>{customInput}</Text>
          </Box>
        ) : (
          <Text dimColor>Press Enter to start, type agent names to customize, or Esc to cancel</Text>
        )}
      </Box>
    );
  }

  if (phase === 'running' && orchestrator && synthesizer) {
    return (
      <App
        task={task}
        agents={agents}
        onExecute={async () => orchestrator.execute(task)}
        onSynthesize={async (results: AgentResult[]) => synthesizer.synthesize(task, results)}
        onExit={() => {
          setPhase('done');
          onComplete();
        }}
        verbose={verbose}
      />
    );
  }

  return null;
}
