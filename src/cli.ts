#!/usr/bin/env node

/**
 * swarm-cli - Multi-Agent Deliberation CLI
 * 
 * Runs coding tasks across multiple AI CLI agents in parallel,
 * then synthesizes conflicts for human decision.
 * 
 * Now with interactive Ink UI for real-time progress and decision making!
 * 
 * Supports flexible model selection with provider:variant syntax
 * and multiple auth strategies (CLI or API).
 */

import React from 'react';
import { render } from 'ink';
import { Orchestrator } from './orchestrator.js';
import { Synthesizer } from './synthesizer.js';
import { SynthesisResult, AgentResult, FileConflict } from './types.js';
import { loadConfig, getConfigPath, validateModelSpec, initConfig, saveConfig } from './config.js';
import { ProviderRegistry, listAllModels } from './models/index.js';
import { App, Decision } from './ui/index.js';
import { writeSwarmLog, SwarmLogEntry, DecisionEntry, createCommitMessage } from './logging.js';
import { Applier } from './applier.js';
import path from 'node:path';

interface CliArgs {
  task: string;
  agents: string[];
  synthesizer: string;
  repoPath: string;
  verbose: boolean;
  outputFormat: 'json' | 'text';
  cleanup: boolean;
  listModels: boolean;
  initConfig: boolean;
  interactive: boolean;
  apply: boolean;       // Auto-apply chosen changes
  logToFile: boolean;   // Write to SWARM_LOG.md
}

// Track orchestrator globally for cleanup on signals
let globalOrchestrator: Orchestrator | null = null;
let cleanupInProgress = false;

/**
 * Handle graceful shutdown
 */
async function handleShutdown(signal: string): Promise<void> {
  if (cleanupInProgress) {
    console.log('\nForced exit.');
    process.exit(1);
  }
  
  cleanupInProgress = true;
  console.log(`\n\n⚠️  Received ${signal}, cleaning up...`);
  
  if (globalOrchestrator) {
    try {
      await globalOrchestrator.cleanup();
      console.log('✅ Worktrees cleaned up.');
    } catch (err) {
      console.error('⚠️  Cleanup failed:', (err as Error).message);
    }
  }
  
  process.exit(0);
}

// Set up signal handlers
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

async function parseArgs(): Promise<CliArgs> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version')) {
    // Version is embedded at build time
    console.log('swarm-cli v0.1.0');
    process.exit(0);
  }

  if (args.includes('--list-models') || args.includes('--list-agents')) {
    return {
      task: '',
      agents: [],
      synthesizer: '',
      repoPath: process.cwd(),
      verbose: false,
      outputFormat: 'text',
      cleanup: true,
      listModels: true,
      initConfig: false,
      interactive: false,
      apply: false,
      logToFile: true,
    };
  }

  if (args.includes('--init')) {
    return {
      task: '',
      agents: [],
      synthesizer: '',
      repoPath: process.cwd(),
      verbose: false,
      outputFormat: 'text',
      cleanup: true,
      listModels: false,
      initConfig: true,
      interactive: false,
      apply: false,
      logToFile: true,
    };
  }

  // Load config first
  const config = await loadConfig();

  const result: CliArgs = {
    task: '',
    agents: config.defaultAgents,
    synthesizer: config.defaultSynthesizer,
    repoPath: process.cwd(),
    verbose: false,
    outputFormat: 'text',
    cleanup: true,
    listModels: false,
    initConfig: false,
    interactive: true,
    apply: false,
    logToFile: true,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--agents' || arg === '-a') {
      const agentList = args[++i];
      if (agentList) {
        result.agents = agentList.split(',').map(s => s.trim());
      }
    } else if (arg === '--synthesizer' || arg === '-s') {
      result.synthesizer = args[++i] || config.defaultSynthesizer;
    } else if (arg === '--repo' || arg === '-r') {
      result.repoPath = args[++i] || process.cwd();
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--json') {
      result.outputFormat = 'json';
      result.interactive = false;
    } else if (arg === '--no-cleanup') {
      result.cleanup = false;
    } else if (arg === '--no-ui' || arg === '--batch') {
      result.interactive = false;
    } else if (arg === '--ui' || arg === '-i') {
      result.interactive = true;
    } else if (arg === '--apply') {
      result.apply = true;
    } else if (arg === '--no-log') {
      result.logToFile = false;
    } else if (!arg.startsWith('-')) {
      result.task = arg;
    }
    i++;
  }

  // Validate task is provided
  if (!result.task) {
    console.error('❌ Error: Task is required\n');
    console.error('Usage: swarm "<task>" [options]');
    console.error('Run "swarm --help" for more information.\n');
    process.exit(1);
  }

  // Validate task is not empty
  if (result.task.trim().length === 0) {
    console.error('❌ Error: Task cannot be empty\n');
    process.exit(1);
  }

  // Validate agents list
  if (result.agents.length === 0) {
    console.error('❌ Error: No agents specified\n');
    console.error('Configure default agents in ~/.swarm/config.json or use --agents flag.');
    console.error('Run "swarm --list-models" to see available agents.\n');
    process.exit(1);
  }

  // Validate model specs
  for (const agent of result.agents) {
    const validation = validateModelSpec(agent);
    if (!validation.valid) {
      console.error(`❌ Error: ${validation.error}`);
      process.exit(1);
    }
  }

  const synthValidation = validateModelSpec(result.synthesizer);
  if (!synthValidation.valid) {
    console.error(`❌ Error: ${synthValidation.error}`);
    process.exit(1);
  }

  return result;
}

function printHelp(): void {
  const availableModels = listAllModels().join(', ');
  const providers = ProviderRegistry.list().join(', ');
  
  console.log(`
swarm - Multi-Agent Deliberation CLI

Usage: swarm "<task>" [options]

Arguments:
  task                       The coding task to execute (required, in quotes)

Options:
  -a, --agents <list>        Comma-separated list of agents/models
                             Format: provider:variant (e.g., claude:opus, gemini:pro)
                             Default: from config or 'claude'
                             
  -s, --synthesizer <model>  Model to use for synthesis
                             Format: provider:variant (e.g., claude:sonnet)
                             Default: from config or 'claude:sonnet'
                             
  -r, --repo <path>          Repository path (default: current directory)
  -v, --verbose              Enable verbose output
  
  -i, --ui                   Enable interactive UI (default)
  --no-ui, --batch           Disable interactive UI (batch mode)
  
  --apply                    Auto-apply chosen agent's changes to main
  --no-log                   Don't write to SWARM_LOG.md
  --json                     Output synthesis as JSON (implies --no-ui)
  --no-cleanup               Don't cleanup worktrees after execution
  --list-models              Show available models and their status
  --init                     Create default config file
  --version                  Show version number
  -h, --help                 Show this help message

Available Providers: ${providers}
Available Models: ${availableModels}

Examples:
  swarm "add input validation to user forms"
  swarm "refactor auth" --agents claude:opus,gemini:pro
  swarm "add tests" --agents claude:sonnet,codex --synthesizer claude:opus
  swarm "fix bug" --verbose --json
  swarm "review code" --no-ui --apply

Interactive UI:
  The interactive UI shows real-time agent progress and allows you to
  resolve conflicts interactively. Use --no-ui for batch/CI environments.

Configuration:
  Config file: ~/.swarm/config.json
  
  The config file sets defaults for agents, synthesizer, and auth methods.
  Run 'swarm --init' to create a default config file.
  
  Environment variables:
    ANTHROPIC_API_KEY    - For Claude API auth
    OPENAI_API_KEY       - For OpenAI/Codex API auth  
    GEMINI_API_KEY       - For Gemini API auth
    SWARM_AGENTS         - Override default agents
    SWARM_SYNTHESIZER    - Override default synthesizer

Logging:
  Session logs are written to SWARM_LOG.md in the repository.
  This includes: task, agents used, conflicts found, decisions made.
  Use --no-log to disable.

Ctrl+C:
  Press Ctrl+C to gracefully cancel and cleanup worktrees.
`);
}

async function listModels(): Promise<void> {
  console.log('\n🤖 Available Models:\n');
  
  const providers = ProviderRegistry.list();
  
  for (const providerName of providers) {
    const def = ProviderRegistry.getDefinition(providerName);
    if (!def) continue;
    
    console.log(`📦 ${def.displayName} (${def.name})`);
    
    // Check availability
    const provider = ProviderRegistry.get(providerName);
    const available = provider ? await provider.checkAvailable() : false;
    const statusIcon = available ? '✅' : '⚫';
    
    console.log(`   Status: ${statusIcon} ${available ? 'Available' : 'Not available'}`);
    console.log(`   Auth: ${def.authStrategies.map(s => s.type).join(', ')}`);
    console.log(`   Variants:`);
    
    for (const variant of def.variants) {
      const isDefault = variant.id === def.defaultVariant;
      console.log(`     • ${providerName}:${variant.id} - ${variant.displayName}${isDefault ? ' (default)' : ''}`);
    }
    console.log('');
  }
  
  console.log(`Config file: ${getConfigPath()}`);
  console.log(`\nUse --agents <model1,model2,...> to specify which models to use.`);
  console.log(`Example: swarm "fix bug" --agents claude:opus,gemini:pro --synthesizer claude:sonnet\n`);
}

async function initConfigFile(): Promise<void> {
  await initConfig();
  console.log(`
✅ Config initialized at ${getConfigPath()}

Default configuration created with:
  • Default agents: claude
  • Default synthesizer: claude:sonnet
  • Auth mode: CLI (uses installed CLI tools)

Edit ~/.swarm/config.json to customize:
  • Add more default agents
  • Switch to API auth mode
  • Configure provider-specific settings

Available options:
{
  "defaultAgents": ["claude:sonnet", "gemini:pro"],
  "defaultSynthesizer": "claude:opus",
  "providers": {
    "claude": { "auth": "api" },    // Use API key
    "gemini": { "auth": "cli" }     // Use CLI tool
  }
}

Run 'swarm --list-models' to see available models and their status.
`);
}

function formatTextOutput(synthesis: SynthesisResult): string {
  const lines: string[] = [];
  
  lines.push('═'.repeat(60));
  lines.push('  SWARM SYNTHESIS REPORT');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`Task: ${synthesis.task}`);
  lines.push(`Time: ${synthesis.timestamp}`);
  lines.push('');

  // Agent Summaries
  lines.push('─'.repeat(60));
  lines.push('  AGENT SUMMARIES');
  lines.push('─'.repeat(60));
  
  for (const agent of synthesis.agentResults) {
    const status = agent.success ? '✅' : '❌';
    lines.push('');
    lines.push(`${status} ${agent.agentName.toUpperCase()}`);
    lines.push(`   Approach: ${agent.approach}`);
    lines.push(`   Files: ${agent.filesChanged.join(', ') || 'None'}`);
    
    if (agent.keyChanges.length > 0) {
      lines.push('   Key Changes:');
      for (const change of agent.keyChanges) {
        lines.push(`     • ${change}`);
      }
    }
    
    if (agent.strengths.length > 0) {
      lines.push('   Strengths:');
      for (const s of agent.strengths) {
        lines.push(`     ✓ ${s}`);
      }
    }
    
    if (agent.weaknesses.length > 0) {
      lines.push('   Weaknesses:');
      for (const w of agent.weaknesses) {
        lines.push(`     ✗ ${w}`);
      }
    }
  }

  // Conflicts
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('  CONFLICTS');
  lines.push('─'.repeat(60));
  
  if (synthesis.conflicts.length === 0) {
    lines.push('');
    lines.push('  No conflicts detected! 🎉');
  } else {
    for (const conflict of synthesis.conflicts) {
      const severityIcon = {
        high: '🔴',
        medium: '🟡',
        low: '🟢',
      }[conflict.severity];
      
      lines.push('');
      lines.push(`${severityIcon} ${conflict.filePath} [${conflict.severity.toUpperCase()}]`);
      lines.push(`   Type: ${conflict.conflictType.replace(/_/g, ' ')}`);
      lines.push(`   ${conflict.description}`);
      
      for (const agent of conflict.agents) {
        lines.push(`   • ${agent.agentName}: ${agent.change}`);
      }
    }
  }

  // Recommendations
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('  RECOMMENDATIONS');
  lines.push('─'.repeat(60));
  
  for (const rec of synthesis.recommendations) {
    lines.push('');
    lines.push(`📋 ${rec.filePath}`);
    lines.push(`   ${rec.recommendation}`);
    if (rec.preferredAgent) {
      lines.push(`   Preferred: ${rec.preferredAgent}`);
    }
    lines.push(`   Reason: ${rec.reasoning}`);
    if (rec.manualReviewNeeded) {
      lines.push('   ⚠️  Manual review needed');
    }
  }

  // Overall Assessment
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('  OVERALL ASSESSMENT');
  lines.push('─'.repeat(60));
  lines.push('');
  lines.push(synthesis.overallAssessment);

  if (synthesis.suggestedMergeOrder) {
    lines.push('');
    lines.push(`Suggested merge order: ${synthesis.suggestedMergeOrder.join(' → ')}`);
  }

  lines.push('');
  lines.push('═'.repeat(60));

  return lines.join('\n');
}

/**
 * Run in interactive mode with Ink UI
 */
async function runInteractive(args: CliArgs): Promise<void> {
  const startTime = Date.now();
  
  const orchestrator = new Orchestrator({
    repoPath: args.repoPath,
    verbose: args.verbose,
  });
  
  // Store globally for signal handling
  globalOrchestrator = orchestrator;

  // Add agents
  try {
    await orchestrator.addAgents(args.agents);
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const synthesizer = new Synthesizer({
    model: args.synthesizer,
    verbose: args.verbose,
  });

  // Track decisions and results for logging
  // Using 'any' wrapper to avoid TypeScript closure narrowing issues
  const state: {
    decisions: Map<string, Decision>;
    synthesis: SynthesisResult | null;
    results: AgentResult[];
  } = {
    decisions: new Map(),
    synthesis: null,
    results: [],
  };

  // Render the Ink app
  const { waitUntilExit } = render(
    React.createElement(App, {
      task: args.task,
      agents: args.agents,
      onExecute: async () => {
        const results = await orchestrator.execute(args.task);
        state.results = results;
        return results;
      },
      onSynthesize: async (results: AgentResult[]) => {
        const synthesis = await synthesizer.synthesize(args.task, results);
        state.synthesis = synthesis;
        return synthesis;
      },
      onDecision: async (conflict: FileConflict, decision: Decision) => {
        if (args.verbose) {
          console.log(`Decision for ${conflict.filePath}: ${decision.choice}`);
        }
      },
      onComplete: (decisions: Map<string, Decision>) => {
        state.decisions = decisions;
      },
      verbose: args.verbose,
    })
  );

  // Wait for UI to finish
  await waitUntilExit();

  const duration = Date.now() - startTime;

  // Apply changes if requested
  if (args.apply && state.decisions.size > 0 && state.synthesis) {
    console.log('\n📦 Applying chosen changes...');
    
    const applier = new Applier(args.repoPath, orchestrator.getWorktreeManager());
    const worktrees = orchestrator.getWorktreeManager().getTrackedWorktrees();
    
    // Map decisions to worktrees
    const fileDecisions = new Map<string, { agentName: string; worktreePath: string }>();
    
    for (const [filePath, decision] of state.decisions) {
      if (decision.agentName) {
        const worktree = worktrees.find(w => w.branch.includes(decision.agentName!));
        if (worktree) {
          fileDecisions.set(filePath, {
            agentName: decision.agentName,
            worktreePath: worktree.path,
          });
        }
      }
    }

    if (fileDecisions.size > 0) {
      const results = await applier.createApplySession(fileDecisions);
      for (const result of results) {
        if (result.success) {
          console.log(`  ✅ Applied: ${result.files.join(', ')}`);
        } else {
          console.log(`  ❌ Failed: ${result.error}`);
        }
      }
    }
  }

  // Write log if enabled
  if (args.logToFile && state.synthesis) {
    const logEntry: SwarmLogEntry = {
      timestamp: new Date().toISOString(),
      task: args.task,
      repoPath: args.repoPath,
      agents: args.agents,
      synthesizer: args.synthesizer,
      duration,
      agentResults: state.results.map(r => ({
        name: r.agentName,
        success: r.success,
        filesChanged: r.filesChanged.length,
      })),
      conflicts: state.synthesis.conflicts.map(c => ({
        filePath: c.filePath,
        severity: c.severity,
        type: c.conflictType,
      })),
      decisions: Array.from(state.decisions.entries()).map(([filePath, d]) => ({
        filePath,
        choice: d.choice,
        agentName: d.agentName,
        customInput: d.customInput,
        timestamp: new Date().toISOString(),
      })),
    };

    try {
      await writeSwarmLog(args.repoPath, logEntry);
      console.log('📝 Session logged to SWARM_LOG.md');
    } catch (err) {
      if (args.verbose) {
        console.log(`⚠️  Could not write log: ${(err as Error).message}`);
      }
    }
  }

  // Cleanup
  if (args.cleanup) {
    console.log('🧹 Cleaning up worktrees...');
    await orchestrator.cleanup();
  } else {
    console.log('📁 Worktrees preserved (--no-cleanup)');
    const worktrees = orchestrator.getWorktreeManager().getTrackedWorktrees();
    for (const wt of worktrees) {
      console.log(`   ${wt.path}`);
    }
  }

  // Output decision summary
  if (state.decisions.size > 0) {
    console.log('\n📝 Decisions made:');
    for (const [file, decision] of state.decisions) {
      console.log(`   ${file}: ${decision.choice}${decision.agentName ? ` (${decision.agentName})` : ''}`);
    }
  }

  console.log('\n✨ Done!');
  globalOrchestrator = null;
}

/**
 * Run in batch mode (original behavior, no interactive UI)
 */
async function runBatch(args: CliArgs): Promise<void> {
  const startTime = Date.now();

  // Check synthesis availability
  const synthAvailable = await Synthesizer.isAvailable(args.synthesizer);
  
  if (!synthAvailable) {
    console.error(`❌ Error: Synthesizer model '${args.synthesizer}' is not available.`);
    console.error('Check that the required CLI is installed or API key is set.');
    console.error('Run "swarm --list-models" to see available models.');
    process.exit(1);
  }

  console.log(`\n🐝 SWARM starting...`);
  console.log(`Task: "${args.task}"`);
  console.log(`Agents: ${args.agents.join(', ')}`);
  console.log(`Synthesizer: ${args.synthesizer}`);
  console.log(`Repo: ${path.resolve(args.repoPath)}`);
  console.log('');

  // Initialize orchestrator
  const orchestrator = new Orchestrator({
    repoPath: args.repoPath,
    verbose: args.verbose,
  });
  
  // Store globally for signal handling
  globalOrchestrator = orchestrator;

  // Add agents
  try {
    await orchestrator.addAgents(args.agents);
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
    process.exit(1);
  }

  let results: AgentResult[] = [];
  let synthesis: SynthesisResult | null = null;

  try {
    // Execute agents in parallel
    console.log('🚀 Running agents in parallel...\n');
    results = await orchestrator.execute(args.task);

    // Check if any agent succeeded
    const successCount = results.filter(r => r.success).length;
    console.log(`\n✓ Execution complete: ${successCount}/${results.length} agents succeeded`);

    // Only synthesize if we have results
    if (results.length > 0 && results.some(r => r.success)) {
      // Synthesize results
      console.log('🔬 Synthesizing results...');
      const synthesizer = new Synthesizer({ 
        model: args.synthesizer,
        verbose: args.verbose 
      });
      
      try {
        synthesis = await synthesizer.synthesize(args.task, results);
      } catch (synthError) {
        console.error(`\n⚠️  Synthesis failed: ${(synthError as Error).message}`);
        console.log('\n📊 Falling back to raw diff summary:\n');
        
        // Show raw diffs as fallback
        for (const result of results) {
          console.log(`\n─── ${result.agentName} ───`);
          console.log(`Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
          console.log(`Files: ${result.filesChanged.join(', ') || 'None'}`);
          if (result.diff) {
            console.log('Diff (truncated):');
            console.log(result.diff.slice(0, 1000) + (result.diff.length > 1000 ? '\n...' : ''));
          }
        }
        synthesis = null;
      }

      // Output results
      if (synthesis) {
        console.log('');
        if (args.outputFormat === 'json') {
          console.log(JSON.stringify(synthesis, null, 2));
        } else {
          console.log(formatTextOutput(synthesis));
        }
      }
    } else if (results.length === 0) {
      console.log('\n⚠️  No agent results to synthesize.');
    } else {
      console.log('\n⚠️  All agents failed. Check agent availability with --list-models.');
    }

    // Write log if enabled
    const duration = Date.now() - startTime;
    
    if (args.logToFile) {
      const logEntry: SwarmLogEntry = {
        timestamp: new Date().toISOString(),
        task: args.task,
        repoPath: args.repoPath,
        agents: args.agents,
        synthesizer: args.synthesizer,
        duration,
        agentResults: results.map(r => ({
          name: r.agentName,
          success: r.success,
          filesChanged: r.filesChanged.length,
        })),
        conflicts: synthesis?.conflicts.map(c => ({
          filePath: c.filePath,
          severity: c.severity,
          type: c.conflictType,
        })) || [],
        decisions: [],
      };

      try {
        await writeSwarmLog(args.repoPath, logEntry);
        console.log('\n📝 Session logged to SWARM_LOG.md');
      } catch (err) {
        if (args.verbose) {
          console.log(`⚠️  Could not write log: ${(err as Error).message}`);
        }
      }
    }

    // Cleanup
    if (args.cleanup) {
      console.log('\n🧹 Cleaning up worktrees...');
      await orchestrator.cleanup();
    } else {
      console.log('\n📁 Worktrees preserved (--no-cleanup)');
      const worktrees = orchestrator.getWorktreeManager().getTrackedWorktrees();
      for (const wt of worktrees) {
        console.log(`   ${wt.path}`);
      }
    }

    console.log('\n✨ Done!');

  } catch (err) {
    console.error(`\n❌ Error: ${(err as Error).message}`);
    
    // Attempt cleanup even on error
    if (args.cleanup) {
      try {
        await orchestrator.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    
    process.exit(1);
  }
  
  globalOrchestrator = null;
}

async function main(): Promise<void> {
  try {
    const args = await parseArgs();

    // Handle --list-models
    if (args.listModels) {
      await listModels();
      return;
    }

    // Handle --init
    if (args.initConfig) {
      await initConfigFile();
      return;
    }

    // Check if TTY is available for interactive mode
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    
    if (args.interactive && isTTY) {
      await runInteractive(args);
    } else {
      if (args.interactive && !isTTY) {
        console.log('ℹ️  Interactive mode not available (not a TTY). Running in batch mode.\n');
      }
      await runBatch(args);
    }
  } catch (err) {
    console.error('❌ Fatal error:', (err as Error).message);
    
    // Cleanup on fatal error
    if (globalOrchestrator) {
      try {
        await globalOrchestrator.cleanup();
      } catch {
        // Ignore
      }
    }
    
    process.exit(1);
  }
}

main();
