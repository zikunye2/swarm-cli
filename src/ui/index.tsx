/**
 * UI module exports
 * 
 * Provides the interactive Ink-based terminal UI for swarm-cli
 */

export { App } from './App.js';
export type { AppProps, AppPhase } from './App.js';

export { AgentProgress } from './AgentProgress.js';
export type { AgentStatus, AgentProgressProps } from './AgentProgress.js';

export { DecisionPanel } from './DecisionPanel.js';
export type { Decision, DecisionPanelProps } from './DecisionPanel.js';

export { SynthesisView } from './SynthesisView.js';
export type { SynthesisViewProps } from './SynthesisView.js';

// Re-export render for convenience
export { render } from 'ink';
