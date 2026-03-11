/**
 * First-run setup wizard.
 *
 * Steps:
 *  1. welcome  — greet, show detected status
 *  2. providers — multi-select providers to enable
 *  3. auth     — per-provider auth method selection + credential input
 *  4. validate — verify credentials
 *  5. done     — save config, hand off to REPL
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { detectAvailableAgents } from './AgentDetector.js';
import { ProviderRegistry } from '../models/provider.js';
import { saveConfig } from '../config.js';
import { validateCredentials } from '../auth/credentials.js';
import type { SetupStep, ProviderStatus } from '../types.js';
import type { SwarmConfig, ProviderConfig, AuthType, ProviderDefinition } from '../models/types.js';

export interface SetupWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

interface ProviderChoice {
  name: string;
  displayName: string;
  selected: boolean;
  def: ProviderDefinition;
}

interface AuthChoice {
  provider: string;
  authType: AuthType;
  envVar?: string;
  valid?: boolean;
  error?: string;
  checked: boolean;
}

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<SetupStep>('welcome');
  const [detected, setDetected] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Provider selection state
  const [providers, setProviders] = useState<ProviderChoice[]>([]);
  const [cursor, setCursor] = useState(0);

  // Auth state — one entry per selected provider
  const [authChoices, setAuthChoices] = useState<AuthChoice[]>([]);
  const [authCursor, setAuthCursor] = useState(0);
  const [authOptionCursor, setAuthOptionCursor] = useState(0);

  // Validation state
  const [validating, setValidating] = useState(false);

  // Detect on mount
  useEffect(() => {
    (async () => {
      const det = await detectAvailableAgents();
      setDetected([...det.available, ...det.unavailable]);

      const allProviders = ProviderRegistry.list();
      setProviders(
        allProviders.map((name) => {
          const def = ProviderRegistry.getDefinition(name)!;
          const status = [...det.available, ...det.unavailable].find((d) => d.name === name);
          return {
            name,
            displayName: def.displayName,
            selected: status?.available ?? false,
            def,
          };
        }),
      );

      setLoading(false);
    })();
  }, []);

  // ── Keyboard ──

  useInput(
    (ch, key) => {
      // Welcome step
      if (step === 'welcome') {
        if (key.return) {
          setStep('providers');
          setCursor(0);
        }
        if (ch === 's' || key.escape) {
          onSkip();
        }
        return;
      }

      // Provider selection
      if (step === 'providers') {
        if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
        if (key.downArrow) setCursor((c) => Math.min(providers.length - 1, c + 1));
        if (ch === ' ') {
          setProviders((prev) =>
            prev.map((p, i) => (i === cursor ? { ...p, selected: !p.selected } : p)),
          );
        }
        if (key.return) {
          const selected = providers.filter((p) => p.selected);
          if (selected.length === 0) return; // need at least one

          // Build auth choices
          const choices: AuthChoice[] = selected.map((p) => {
            const strategies = p.def.authStrategies;
            const preferApi = strategies.find((s) => s.type === 'api');
            return {
              provider: p.name,
              authType: preferApi ? 'api' : strategies[0].type,
              envVar: preferApi?.envVar,
              checked: false,
            };
          });
          setAuthChoices(choices);
          setAuthCursor(0);
          setStep('auth');
        }
        return;
      }

      // Auth method selection (per provider)
      if (step === 'auth') {
        const current = authChoices[authCursor];
        if (!current) return;

        const strategies = providers.find((p) => p.name === current.provider)?.def.authStrategies || [];

        if (key.upArrow || key.downArrow) {
          const types = strategies.map((s) => s.type);
          const idx = types.indexOf(current.authType);
          const next = key.upArrow
            ? Math.max(0, idx - 1)
            : Math.min(types.length - 1, idx + 1);
          setAuthChoices((prev) =>
            prev.map((a, i) =>
              i === authCursor
                ? { ...a, authType: types[next], envVar: strategies[next].envVar }
                : a,
            ),
          );
        }

        if (key.return) {
          if (authCursor < authChoices.length - 1) {
            setAuthCursor((c) => c + 1);
          } else {
            // Move to validation
            setStep('validate');
            runValidation();
          }
        }
        return;
      }

      // Done step
      if (step === 'done') {
        if (key.return) {
          onComplete();
        }
        return;
      }
    },
    { isActive: !validating },
  );

  // ── Validation ──

  async function runValidation() {
    setValidating(true);
    const updated = [...authChoices];

    for (let i = 0; i < updated.length; i++) {
      const ac = updated[i];
      const result = await validateCredentials(ac.provider, ac.authType);
      updated[i] = { ...ac, checked: true, valid: result.valid, error: result.error };
      setAuthChoices([...updated]);
    }

    // Save config
    const selectedProviders = providers.filter((p) => p.selected);
    const config: SwarmConfig = {
      defaultAgents: selectedProviders.map((p) => p.name),
      defaultSynthesizer: selectedProviders[0]
        ? `${selectedProviders[0].name}:${selectedProviders[0].def.defaultVariant}`
        : 'claude:sonnet',
      providers: {},
    };

    for (const ac of updated) {
      const prov = providers.find((p) => p.name === ac.provider);
      config.providers[ac.provider] = {
        auth: ac.authType,
        apiKey: ac.envVar || null,
        defaultVariant: prov?.def.defaultVariant,
      };
    }

    await saveConfig(config);
    setValidating(false);
    setStep('done');
  }

  // ── Render ──

  if (loading) {
    return (
      <Box paddingY={1}>
        <Text color="cyan"><Spinner type="dots" />{' '}</Text>
        <Text>Detecting available agents...</Text>
      </Box>
    );
  }

  // Welcome
  if (step === 'welcome') {
    const avail = detected.filter((d) => d.available);
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="cyan">Welcome to swarm!</Text>
        <Text dimColor>Let's set up your AI agents.</Text>
        <Box marginY={1} flexDirection="column">
          {detected.map((d) => (
            <Text key={d.name}>
              <Text color={d.available ? 'green' : 'red'}>
                {d.available ? '  ✓' : '  ✗'}
              </Text>
              <Text> {d.displayName}</Text>
              {d.available && <Text dimColor> ({d.authType})</Text>}
            </Text>
          ))}
        </Box>
        {avail.length > 0 && (
          <Text dimColor>{avail.length} provider(s) detected with valid credentials</Text>
        )}
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text color="yellow">Enter</Text>
          <Text dimColor> to configure, </Text>
          <Text color="yellow">s</Text>
          <Text dimColor> to skip</Text>
        </Box>
      </Box>
    );
  }

  // Provider selection
  if (step === 'providers') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Select providers to enable:</Text>
        <Text dimColor>Space to toggle, Enter to confirm</Text>
        <Box marginY={1} flexDirection="column">
          {providers.map((p, i) => (
            <Text key={p.name}>
              <Text color={i === cursor ? 'cyan' : undefined}>
                {i === cursor ? '>' : ' '} [{p.selected ? '✓' : ' '}] {p.displayName}
              </Text>
              <Text dimColor> ({p.def.variants.map((v) => v.id).join(', ')})</Text>
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  // Auth method per provider
  if (step === 'auth') {
    const current = authChoices[authCursor];
    const prov = providers.find((p) => p.name === current?.provider);
    const strategies = prov?.def.authStrategies || [];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>
          Configure auth for {prov?.displayName} ({authCursor + 1}/{authChoices.length})
        </Text>
        <Text dimColor>Arrow keys to select, Enter to confirm</Text>
        <Box marginY={1} flexDirection="column">
          {strategies.map((s) => {
            const selected = current?.authType === s.type;
            const label =
              s.type === 'api'
                ? `API Key (env: ${s.envVar || '?'})`
                : s.type === 'oauth'
                  ? 'OAuth (from CLI login)'
                  : `CLI (${s.cliCommand || 'auto'})`;
            return (
              <Text key={s.type}>
                <Text color={selected ? 'cyan' : undefined}>
                  {selected ? '> ' : '  '}
                  {selected ? '●' : '○'} {label}
                </Text>
              </Text>
            );
          })}
        </Box>
        {current?.authType === 'api' && current.envVar && (
          <Text dimColor>
            Make sure {current.envVar} is set in your shell environment.
          </Text>
        )}
        {current?.authType === 'oauth' && (
          <Text dimColor>
            Ensure you've logged in via the provider's CLI first.
          </Text>
        )}
      </Box>
    );
  }

  // Validation
  if (step === 'validate') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Validating credentials...</Text>
        <Box marginY={1} flexDirection="column">
          {authChoices.map((ac) => {
            const prov = providers.find((p) => p.name === ac.provider);
            if (!ac.checked) {
              return (
                <Text key={ac.provider}>
                  <Text color="cyan"><Spinner type="dots" />{' '}</Text>
                  <Text>{prov?.displayName}</Text>
                </Text>
              );
            }
            return (
              <Text key={ac.provider}>
                <Text color={ac.valid ? 'green' : 'red'}>
                  {ac.valid ? '  ✓' : '  ✗'}
                </Text>
                <Text> {prov?.displayName}</Text>
                {ac.error && <Text color="red" dimColor> — {ac.error}</Text>}
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  // Done
  if (step === 'done') {
    const valid = authChoices.filter((a) => a.valid);
    const invalid = authChoices.filter((a) => !a.valid);
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="green">Setup complete!</Text>
        <Box marginY={1} flexDirection="column">
          {valid.length > 0 && (
            <Text color="green">  {valid.length} provider(s) ready</Text>
          )}
          {invalid.length > 0 && (
            <Text color="yellow">
              {'  '}{invalid.length} provider(s) need attention (run /config later)
            </Text>
          )}
        </Box>
        <Text dimColor>Config saved to ~/.swarm/config.json</Text>
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text color="yellow">Enter</Text>
          <Text dimColor> to start using swarm</Text>
        </Box>
      </Box>
    );
  }

  return null;
}
