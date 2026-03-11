/**
 * Root Ink component for swarm-cli
 * 
 * Orchestrates the entire UI flow:
 * 1. Shows progress during agent execution
 * 2. Displays synthesis results
 * 3. Handles interactive decision flow for conflicts
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { AgentProgress, AgentStatus } from './AgentProgress.js';
import { SynthesisView } from './SynthesisView.js';
import { DecisionPanel, Decision } from './DecisionPanel.js';
import { SynthesisResult, FileConflict, AgentResult } from '../types.js';

export type AppPhase = 'agents' | 'synthesizing' | 'results' | 'decisions' | 'complete';

export interface AppProps {
  task: string;
  agents: string[];
  onExecute: () => Promise<AgentResult[]>;
  onSynthesize: (results: AgentResult[]) => Promise<SynthesisResult>;
  onDecision?: (conflict: FileConflict, decision: Decision) => Promise<void>;
  onComplete?: (decisions: Map<string, Decision>) => void;
  onExit?: () => void;
  verbose?: boolean;
}

export function App({
  task,
  agents,
  onExecute,
  onSynthesize,
  onDecision,
  onComplete,
  onExit,
  verbose = false,
}: AppProps) {
  const { exit: inkExit } = useApp();
  const exit = onExit || inkExit;
  
  // Phase management
  const [phase, setPhase] = useState<AppPhase>('agents');
  const [error, setError] = useState<string | null>(null);
  
  // Agent progress state
  const [agentStatuses, setAgentStatuses] = useState<Map<string, AgentStatus>>(
    new Map(agents.map(a => [a, { name: a, status: 'pending' }]))
  );
  
  // Results state
  const [agentResults, setAgentResults] = useState<AgentResult[]>([]);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  
  // Decision state
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  
  // Track if we're viewing results before decisions
  const [viewingResults, setViewingResults] = useState(false);

  // Update agent status helper
  const updateAgentStatus = useCallback((name: string, update: Partial<AgentStatus>) => {
    setAgentStatuses(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(name) || { name, status: 'pending' as const };
      newMap.set(name, { ...current, ...update });
      return newMap;
    });
  }, []);

  // Run agents on mount
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // Mark all as running
        agents.forEach(a => updateAgentStatus(a, { status: 'running', startTime: Date.now() }));
        
        // Execute agents
        const results = await onExecute();
        
        if (cancelled) return;
        
        // Update statuses based on results
        for (const result of results) {
          updateAgentStatus(result.agentName, {
            status: result.success ? 'done' : 'failed',
            endTime: Date.now(),
            error: result.error,
            filesChanged: result.filesChanged.length,
          });
        }
        
        setAgentResults(results);
        setPhase('synthesizing');
        
        // Run synthesis
        const synthResult = await onSynthesize(results);
        
        if (cancelled) return;
        
        setSynthesis(synthResult);
        
        // If there are conflicts, go to decisions; otherwise complete
        if (synthResult.conflicts.length > 0) {
          setPhase('results');
          setViewingResults(true);
        } else {
          setPhase('complete');
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle decision submission
  const handleDecision = useCallback(async (decision: Decision) => {
    if (!synthesis) return;
    
    const conflict = synthesis.conflicts[currentConflictIndex];
    
    // Store decision
    const newDecisions = new Map(decisions);
    newDecisions.set(conflict.filePath, decision);
    setDecisions(newDecisions);
    
    // Call callback if provided
    if (onDecision) {
      await onDecision(conflict, decision);
    }
    
    // Move to next conflict or complete
    if (currentConflictIndex < synthesis.conflicts.length - 1) {
      setCurrentConflictIndex(prev => prev + 1);
    } else {
      setPhase('complete');
      if (onComplete) {
        onComplete(newDecisions);
      }
    }
  }, [synthesis, currentConflictIndex, decisions, onDecision, onComplete]);

  // Handle keyboard input for navigation
  useInput((input, key) => {
    // Exit on q or Ctrl+C
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    
    // In results view, press Enter or Space to proceed to decisions
    if (viewingResults && (key.return || input === ' ')) {
      setViewingResults(false);
      setPhase('decisions');
    }
    
    // In complete phase, any key exits
    if (phase === 'complete' && (key.return || input === ' ')) {
      exit();
    }
  });

  // Render error state
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>❌ Error</Text>
        <Text color="red">{error}</Text>
        <Text dimColor>Press q to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>🐝 SWARM</Text>
        <Text> — </Text>
        <Text dimColor>{task.length > 50 ? task.slice(0, 50) + '...' : task}</Text>
      </Box>

      {/* Agent Progress Phase */}
      {(phase === 'agents' || phase === 'synthesizing') && (
        <AgentProgress 
          statuses={agentStatuses} 
          synthesizing={phase === 'synthesizing'}
        />
      )}

      {/* Synthesis Results View */}
      {phase === 'results' && synthesis && viewingResults && (
        <>
          <SynthesisView synthesis={synthesis} />
          <Box marginTop={1}>
            <Text dimColor>Press </Text>
            <Text color="yellow">Enter</Text>
            <Text dimColor> to resolve conflicts, </Text>
            <Text color="red">q</Text>
            <Text dimColor> to quit</Text>
          </Box>
        </>
      )}

      {/* Decision Panel */}
      {phase === 'decisions' && synthesis && synthesis.conflicts.length > 0 && (
        <DecisionPanel
          conflict={synthesis.conflicts[currentConflictIndex]}
          currentIndex={currentConflictIndex}
          totalCount={synthesis.conflicts.length}
          recommendation={synthesis.recommendations.find(
            r => r.filePath === synthesis.conflicts[currentConflictIndex].filePath
          )}
          onDecision={handleDecision}
        />
      )}

      {/* Complete Phase */}
      {phase === 'complete' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="green" bold>✨ Complete!</Text>
          </Box>
          
          {synthesis && (
            <>
              <Text>
                <Text dimColor>Agents: </Text>
                <Text color="green">{agentResults.filter(r => r.success).length}</Text>
                <Text dimColor>/</Text>
                <Text>{agentResults.length}</Text>
                <Text dimColor> succeeded</Text>
              </Text>
              
              <Text>
                <Text dimColor>Conflicts: </Text>
                <Text color={synthesis.conflicts.length > 0 ? 'yellow' : 'green'}>
                  {synthesis.conflicts.length}
                </Text>
                {decisions.size > 0 && (
                  <Text dimColor> ({decisions.size} resolved)</Text>
                )}
              </Text>
              
              {synthesis.suggestedMergeOrder && (
                <Text>
                  <Text dimColor>Merge order: </Text>
                  <Text>{synthesis.suggestedMergeOrder.join(' → ')}</Text>
                </Text>
              )}
            </>
          )}
          
          <Box marginTop={1}>
            <Text dimColor>Press </Text>
            <Text color="yellow">Enter</Text>
            <Text dimColor> to exit</Text>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          {phase === 'agents' && '► Running agents...'}
          {phase === 'synthesizing' && '► Synthesizing results...'}
          {phase === 'results' && '► Review results'}
          {phase === 'decisions' && `► Decision ${currentConflictIndex + 1}/${synthesis?.conflicts.length || 0}`}
          {phase === 'complete' && '► Done'}
        </Text>
      </Box>
    </Box>
  );
}

export default App;
