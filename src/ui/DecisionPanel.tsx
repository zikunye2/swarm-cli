/**
 * DecisionPanel - Conflict resolution interface
 * 
 * Displays one conflict at a time with:
 * - Options from different agents
 * - Keyboard navigation (a/b/c to choose)
 * - Synthesizer recommendation
 * - Custom input option
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { FileConflict, Recommendation } from '../types.js';

export interface Decision {
  choice: 'a' | 'b' | 'c' | 'd' | 'custom' | 'skip';
  agentName?: string;
  customInput?: string;
}

export interface DecisionPanelProps {
  conflict: FileConflict;
  currentIndex: number;
  totalCount: number;
  recommendation?: Recommendation;
  onDecision: (decision: Decision) => void;
}

// Severity colors and icons
const severityConfig = {
  high: { color: 'red' as const, icon: '🔴', label: 'HIGH' },
  medium: { color: 'yellow' as const, icon: '🟡', label: 'MEDIUM' },
  low: { color: 'green' as const, icon: '🟢', label: 'LOW' },
};

// Option key labels
const optionKeys = ['a', 'b', 'c', 'd'] as const;

export function DecisionPanel({
  conflict,
  currentIndex,
  totalCount,
  recommendation,
  onDecision,
}: DecisionPanelProps) {
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  
  const severity = severityConfig[conflict.severity];
  const agents = conflict.agents;
  
  // Handle keyboard input
  useInput((input, key) => {
    if (customMode) {
      // In custom mode, handle text input
      if (key.return) {
        if (customInput.trim()) {
          onDecision({ choice: 'custom', customInput: customInput.trim() });
        }
        setCustomMode(false);
        setCustomInput('');
      } else if (key.escape) {
        setCustomMode(false);
        setCustomInput('');
      } else if (key.backspace || key.delete) {
        setCustomInput(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setCustomInput(prev => prev + input);
      }
      return;
    }
    
    // Option selection (a, b, c, d)
    const keyIndex = optionKeys.indexOf(input.toLowerCase() as typeof optionKeys[number]);
    if (keyIndex !== -1 && keyIndex < agents.length) {
      setSelectedIndex(keyIndex);
      onDecision({
        choice: optionKeys[keyIndex],
        agentName: agents[keyIndex].agentName,
      });
      return;
    }
    
    // Custom input mode
    if (input === 'c' && agents.length < 3) {
      setCustomMode(true);
      return;
    }
    
    // Skip
    if (input === 's') {
      onDecision({ choice: 'skip' });
      return;
    }
    
    // Arrow keys for navigation (visual only)
    if (key.upArrow) {
      setSelectedIndex(prev => {
        if (prev === null || prev === 0) return agents.length - 1;
        return prev - 1;
      });
    } else if (key.downArrow) {
      setSelectedIndex(prev => {
        if (prev === null || prev >= agents.length - 1) return 0;
        return prev + 1;
      });
    }
    
    // Enter to confirm selection
    if (key.return && selectedIndex !== null) {
      onDecision({
        choice: optionKeys[selectedIndex],
        agentName: agents[selectedIndex].agentName,
      });
    }
  });

  // Format conflict type for display
  const formatConflictType = (type: string): string => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor={severity.color} paddingX={2}>
        <Text bold>
          DECISION {currentIndex + 1} of {totalCount} — {conflict.filePath}
        </Text>
      </Box>

      {/* Conflict info */}
      <Box flexDirection="column" marginY={1} paddingX={1}>
        <Box>
          <Text color={severity.color}>{severity.icon} </Text>
          <Text color={severity.color} bold>{severity.label}</Text>
          <Text dimColor> — </Text>
          <Text>{formatConflictType(conflict.conflictType)}</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>{conflict.description}</Text>
        </Box>
      </Box>

      {/* Options */}
      <Box flexDirection="column" marginY={1}>
        {agents.map((agent, index) => {
          const key = optionKeys[index];
          const isSelected = selectedIndex === index;
          const isRecommended = recommendation?.preferredAgent === agent.agentName;
          
          return (
            <Box 
              key={agent.agentName}
              flexDirection="column"
              marginBottom={1}
              paddingX={1}
              borderStyle={isSelected ? 'single' : undefined}
              borderColor={isSelected ? 'cyan' : undefined}
            >
              <Box>
                <Text color="yellow" bold>({key}) </Text>
                <Text color="cyan" bold>[{agent.agentName}] </Text>
                <Text>{agent.change}</Text>
                {isRecommended && (
                  <Text color="green"> 💡 Recommended</Text>
                )}
              </Box>
              
              {agent.content && (
                <Box marginLeft={4} marginTop={0}>
                  <Text dimColor>→ {agent.content.slice(0, 100)}{agent.content.length > 100 ? '...' : ''}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Recommendation */}
      {recommendation && (
        <Box 
          flexDirection="column" 
          marginY={1} 
          paddingX={1}
          borderStyle="round"
          borderColor="green"
        >
          <Box>
            <Text color="green">💡 Recommendation: </Text>
            <Text bold>{recommendation.recommendation}</Text>
          </Box>
          {recommendation.reasoning && (
            <Box marginTop={0}>
              <Text dimColor>Reason: {recommendation.reasoning}</Text>
            </Box>
          )}
          {recommendation.manualReviewNeeded && (
            <Box marginTop={0}>
              <Text color="yellow">⚠️ Manual review recommended</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Custom input mode */}
      {customMode && (
        <Box flexDirection="column" marginY={1} paddingX={1}>
          <Text color="cyan">Enter custom solution (Esc to cancel):</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <Text>{customInput}</Text>
            <Text color="cyan">▌</Text>
          </Box>
        </Box>
      )}

      {/* Footer with controls */}
      <Box 
        marginTop={1} 
        paddingX={1}
        borderStyle="single"
        borderColor="gray"
      >
        <Text dimColor>
          Press{' '}
          {agents.map((_, i) => (
            <Text key={i}>
              <Text color="yellow">{optionKeys[i]}</Text>
              {i < agents.length - 1 ? '/' : ''}
            </Text>
          ))}
          {' '}to choose
          {' • '}
          <Text color="yellow">↑↓</Text> navigate
          {' • '}
          <Text color="yellow">Enter</Text> confirm
          {' • '}
          <Text color="yellow">s</Text> skip
          {' • '}
          <Text color="red">q</Text> quit
        </Text>
      </Box>
    </Box>
  );
}

export default DecisionPanel;
