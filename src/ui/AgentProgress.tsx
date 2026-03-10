/**
 * AgentProgress - Real-time agent status display
 * 
 * Shows each agent's status with visual indicators:
 * - Pending: ⏳
 * - Running: 🔄 with elapsed time and progress bar
 * - Done: ✅
 * - Failed: ❌
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export interface AgentStatus {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'unavailable';
  startTime?: number;
  endTime?: number;
  error?: string;
  output?: string;
  filesChanged?: number;
}

export interface AgentProgressProps {
  statuses: Map<string, AgentStatus>;
  synthesizing?: boolean;
}

// Progress bar component
function ProgressBar({ 
  elapsed, 
  maxTime = 300 
}: { 
  elapsed: number; 
  maxTime?: number;
}) {
  const width = 16;
  const progress = Math.min(elapsed / maxTime, 1);
  const filled = Math.floor(progress * width);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  return (
    <Text color={progress > 0.8 ? 'yellow' : 'cyan'}>{bar}</Text>
  );
}

// Format duration in seconds
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

// Single agent status row
function AgentRow({ agent }: { agent: AgentStatus }) {
  const [now, setNow] = useState(Date.now());
  
  // Update timer for running agents
  useEffect(() => {
    if (agent.status === 'running') {
      const interval = setInterval(() => setNow(Date.now()), 100);
      return () => clearInterval(interval);
    }
  }, [agent.status]);
  
  const elapsed = agent.startTime 
    ? (agent.endTime || now) - agent.startTime 
    : 0;
  
  // Status icon and color
  let icon: React.ReactNode;
  let statusColor: string;
  let statusText: string;
  
  switch (agent.status) {
    case 'pending':
      icon = <Text color="gray">⏳</Text>;
      statusColor = 'gray';
      statusText = 'waiting';
      break;
    case 'running':
      icon = <Text color="cyan"><Spinner type="dots" /></Text>;
      statusColor = 'cyan';
      statusText = 'running';
      break;
    case 'done':
      icon = <Text color="green">✅</Text>;
      statusColor = 'green';
      statusText = 'done';
      break;
    case 'failed':
      icon = <Text color="red">❌</Text>;
      statusColor = 'red';
      statusText = 'failed';
      break;
    case 'unavailable':
      icon = <Text color="gray">⚫</Text>;
      statusColor = 'gray';
      statusText = 'unavailable';
      break;
    default:
      icon = <Text>?</Text>;
      statusColor = 'white';
      statusText = 'unknown';
  }
  
  return (
    <Box>
      <Box width={3}>
        {icon}
      </Box>
      <Box width={20}>
        <Text color={statusColor} bold={agent.status === 'running'}>
          {agent.name}
        </Text>
      </Box>
      <Box width={20}>
        {agent.status === 'running' && (
          <ProgressBar elapsed={elapsed / 1000} />
        )}
        {agent.status === 'done' && agent.filesChanged !== undefined && (
          <Text color="green">
            {agent.filesChanged} file{agent.filesChanged !== 1 ? 's' : ''} changed
          </Text>
        )}
        {agent.status === 'failed' && (
          <Text color="red">error</Text>
        )}
      </Box>
      <Box>
        {elapsed > 0 && (
          <Text dimColor> {formatDuration(elapsed)}</Text>
        )}
      </Box>
    </Box>
  );
}

export function AgentProgress({ statuses, synthesizing = false }: AgentProgressProps) {
  const agents = Array.from(statuses.values());
  
  // Count statuses
  const done = agents.filter(a => a.status === 'done').length;
  const failed = agents.filter(a => a.status === 'failed').length;
  const running = agents.filter(a => a.status === 'running').length;
  const total = agents.length;
  
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>
          {synthesizing ? (
            <>
              <Text color="magenta"><Spinner type="dots" /></Text>
              <Text> Synthesizing results...</Text>
            </>
          ) : (
            <>
              <Text color="cyan">►</Text>
              <Text> Running </Text>
              <Text color="cyan">{total}</Text>
              <Text> agent{total !== 1 ? 's' : ''}...</Text>
            </>
          )}
        </Text>
      </Box>
      
      {/* Agent list */}
      <Box flexDirection="column" marginLeft={2}>
        {agents.map(agent => (
          <AgentRow key={agent.name} agent={agent} />
        ))}
      </Box>
      
      {/* Summary */}
      {!synthesizing && (done > 0 || failed > 0) && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>
            {running > 0 && <Text color="cyan">{running} running  </Text>}
            {done > 0 && <Text color="green">{done} done  </Text>}
            {failed > 0 && <Text color="red">{failed} failed</Text>}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default AgentProgress;
