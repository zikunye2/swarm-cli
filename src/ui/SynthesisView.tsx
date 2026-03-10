/**
 * SynthesisView - Results display component
 * 
 * Shows:
 * - Summary of what agents did
 * - List of agreements
 * - Conflict overview (navigate to resolve)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { SynthesisResult, AgentSummary, FileConflict } from '../types.js';

export interface SynthesisViewProps {
  synthesis: SynthesisResult;
  compact?: boolean;
}

// Status icon for agent success
function StatusIcon({ success }: { success: boolean }) {
  return success 
    ? <Text color="green">✅</Text>
    : <Text color="red">❌</Text>;
}

// Severity badge
function SeverityBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { color: 'red' as const, icon: '🔴' },
    medium: { color: 'yellow' as const, icon: '🟡' },
    low: { color: 'green' as const, icon: '🟢' },
  };
  const c = config[severity];
  
  return (
    <Text color={c.color}>{c.icon} {severity.toUpperCase()}</Text>
  );
}

// Agent summary card
function AgentCard({ agent }: { agent: AgentSummary }) {
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      <Box>
        <StatusIcon success={agent.success} />
        <Text> </Text>
        <Text bold color="cyan">{agent.agentName.toUpperCase()}</Text>
      </Box>
      
      <Box marginLeft={3} flexDirection="column">
        <Text dimColor>Approach: </Text>
        <Text>{agent.approach.slice(0, 80)}{agent.approach.length > 80 ? '...' : ''}</Text>
        
        {agent.filesChanged.length > 0 && (
          <Box marginTop={0}>
            <Text dimColor>Files: </Text>
            <Text color="blue">{agent.filesChanged.join(', ')}</Text>
          </Box>
        )}
        
        {agent.keyChanges.length > 0 && (
          <Box flexDirection="column" marginTop={0}>
            <Text dimColor>Key changes:</Text>
            {agent.keyChanges.slice(0, 3).map((change, i) => (
              <Text key={i}>  • {change}</Text>
            ))}
            {agent.keyChanges.length > 3 && (
              <Text dimColor>  ... and {agent.keyChanges.length - 3} more</Text>
            )}
          </Box>
        )}
        
        {agent.strengths.length > 0 && (
          <Box marginTop={0}>
            <Text color="green">✓ </Text>
            <Text>{agent.strengths[0]}</Text>
          </Box>
        )}
        
        {agent.weaknesses.length > 0 && (
          <Box marginTop={0}>
            <Text color="yellow">⚠ </Text>
            <Text>{agent.weaknesses[0]}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// Conflict summary row
function ConflictRow({ conflict, index }: { conflict: FileConflict; index: number }) {
  return (
    <Box paddingLeft={2}>
      <Box width={4}>
        <Text dimColor>{index + 1}.</Text>
      </Box>
      <Box width={8}>
        <SeverityBadge severity={conflict.severity} />
      </Box>
      <Box width={30}>
        <Text color="blue">{conflict.filePath}</Text>
      </Box>
      <Text dimColor>
        {conflict.conflictType.replace(/_/g, ' ')}
      </Text>
    </Box>
  );
}

export function SynthesisView({ synthesis, compact = false }: SynthesisViewProps) {
  const hasConflicts = synthesis.conflicts.length > 0;
  const successCount = synthesis.agentResults.filter(a => a.success).length;
  
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box 
        borderStyle="single" 
        borderColor="cyan" 
        paddingX={2}
        marginBottom={1}
      >
        <Text bold color="cyan">📊 SYNTHESIS RESULTS</Text>
      </Box>

      {/* Quick stats */}
      <Box marginBottom={1} paddingX={1}>
        <Box marginRight={3}>
          <Text dimColor>Agents: </Text>
          <Text color="green">{successCount}</Text>
          <Text dimColor>/{synthesis.agentResults.length} succeeded</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>Conflicts: </Text>
          <Text color={hasConflicts ? 'yellow' : 'green'}>
            {synthesis.conflicts.length}
          </Text>
        </Box>
        <Box>
          <Text dimColor>Files: </Text>
          <Text>
            {[...new Set(synthesis.agentResults.flatMap(a => a.filesChanged))].length}
          </Text>
        </Box>
      </Box>

      {/* Agent Summaries */}
      {!compact && (
        <Box flexDirection="column" marginBottom={1}>
          <Box paddingX={1}>
            <Text bold underline>Agent Summaries</Text>
          </Box>
          {synthesis.agentResults.map(agent => (
            <AgentCard key={agent.agentName} agent={agent} />
          ))}
        </Box>
      )}

      {/* Conflicts Section */}
      {hasConflicts && (
        <Box flexDirection="column" marginBottom={1}>
          <Box paddingX={1}>
            <Text bold underline color="yellow">
              ⚠️ Conflicts Requiring Decision ({synthesis.conflicts.length})
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {synthesis.conflicts.map((conflict, i) => (
              <ConflictRow key={conflict.filePath} conflict={conflict} index={i} />
            ))}
          </Box>
        </Box>
      )}

      {/* No conflicts message */}
      {!hasConflicts && (
        <Box paddingX={1} marginBottom={1}>
          <Text color="green">🎉 No conflicts detected! All agents produced compatible changes.</Text>
        </Box>
      )}

      {/* Overall Assessment */}
      {synthesis.overallAssessment && !compact && (
        <Box 
          flexDirection="column" 
          paddingX={1}
          borderStyle="round"
          borderColor="gray"
          marginTop={1}
        >
          <Text bold>📝 Assessment</Text>
          <Text wrap="wrap">
            {synthesis.overallAssessment.slice(0, 300)}
            {synthesis.overallAssessment.length > 300 ? '...' : ''}
          </Text>
        </Box>
      )}

      {/* Merge Order Suggestion */}
      {synthesis.suggestedMergeOrder && (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>Suggested merge order: </Text>
          <Text color="cyan">
            {synthesis.suggestedMergeOrder.join(' → ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default SynthesisView;
