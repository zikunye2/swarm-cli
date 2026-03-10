/**
 * Shared types for swarm-cli
 */

// Agent execution result
export interface AgentResult {
  agentName: string;
  worktreePath: string;
  branchName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  filesChanged: string[];
  diff: string;
}

// Agent configuration
export interface AgentConfig {
  name: string;
  command: string;
  args: string[];
  timeout?: number; // ms
}

// Task configuration
export interface TaskConfig {
  prompt: string;
  repoPath: string;
  agents: AgentConfig[];
  baseBranch?: string;
}

// File-level conflict information
export interface FileConflict {
  filePath: string;
  conflictType: 'different_changes' | 'one_modified_one_not' | 'both_added' | 'both_deleted';
  agents: {
    agentName: string;
    change: string; // 'added' | 'modified' | 'deleted'
    content?: string;
    diff?: string;
  }[];
  severity: 'high' | 'medium' | 'low';
  description: string;
}

// Synthesis result
export interface SynthesisResult {
  task: string;
  timestamp: string;
  agentResults: AgentSummary[];
  conflicts: FileConflict[];
  recommendations: Recommendation[];
  overallAssessment: string;
  suggestedMergeOrder?: string[];
}

// Summary of what each agent did
export interface AgentSummary {
  agentName: string;
  success: boolean;
  approach: string;
  filesChanged: string[];
  keyChanges: string[];
  strengths: string[];
  weaknesses: string[];
}

// Recommendation for resolving conflicts
export interface Recommendation {
  filePath: string;
  recommendation: string;
  preferredAgent?: string;
  reasoning: string;
  manualReviewNeeded: boolean;
}

// Worktree info
export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  /** The base commit SHA this worktree was branched from - used for accurate diffs */
  baseCommit: string;
}

// CLI options
export interface CliOptions {
  prompt: string;
  agents?: string[];
  timeout?: number;
  verbose?: boolean;
  outputFormat?: 'json' | 'text';
}
