#!/usr/bin/env node

/**
 * swarm-cli - Multi-Agent Deliberation CLI
 * 
 * Phase 2: Multi-agent support with parallel execution
 */

import { Orchestrator } from './orchestrator.js';
import { Synthesizer } from './synthesizer.js';
import { SynthesisResult } from './types.js';
import path from 'node:path';

interface CliArgs {
  task: string;
  agents: string[];
  repoPath: string;
  verbose: boolean;
  outputFormat: 'json' | 'text';
  cleanup: boolean;
  listAgents: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--list-agents')) {
    return {
      task: '',
      agents: [],
      repoPath: process.cwd(),
      verbose: false,
      outputFormat: 'text',
      cleanup: true,
      listAgents: true,
    };
  }

  const result: CliArgs = {
    task: '',
    agents: ['claude'], // Default to Claude agent
    repoPath: process.cwd(),
    verbose: false,
    outputFormat: 'text',
    cleanup: true,
    listAgents: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--agents' || arg === '-a') {
      const agentArg = args[++i];
      // Handle empty string or missing value - fallback to default
      const parsedAgents = agentArg?.split(',').filter(a => a.trim() !== '');
      result.agents = parsedAgents && parsedAgents.length > 0 ? parsedAgents : ['claude'];
    } else if (arg === '--repo' || arg === '-r') {
      result.repoPath = args[++i] || process.cwd();
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--json') {
      result.outputFormat = 'json';
    } else if (arg === '--no-cleanup') {
      result.cleanup = false;
    } else if (!arg.startsWith('-')) {
      result.task = arg;
    }
    i++;
  }

  if (!result.task) {
    console.error('Error: Task is required');
    printHelp();
    process.exit(1);
  }

  return result;
}

function printHelp(): void {
  const availableAgents = Orchestrator.getAvailableAgents().join(', ');
  
  console.log(`
swarm - Multi-Agent Deliberation CLI

Usage: swarm <task> [options]

Arguments:
  task                    The coding task to execute (required)

Options:
  -a, --agents <list>     Comma-separated list of agents (default: claude)
                          Available: ${availableAgents}
  -r, --repo <path>       Repository path (default: current directory)
  -v, --verbose           Enable verbose output
  --json                  Output synthesis as JSON
  --no-cleanup            Don't cleanup worktrees after execution
  --list-agents           Show available agents and their status
  -h, --help              Show this help message

Examples:
  swarm "add input validation to user forms"
  swarm "refactor the authentication module" --agents claude,codex,gemini
  swarm "add unit tests" --verbose --json
  swarm "fix bug" --agents claude,gemini

Multi-Agent Mode:
  Run multiple AI agents in parallel on the same task. Each agent works
  in an isolated git worktree. After completion, swarm analyzes the
  outputs and identifies conflicts between approaches.

Environment:
  ANTHROPIC_API_KEY       Optional - for direct API synthesis
                          (Falls back to 'claude' CLI if not set)
`);
}

async function listAgents(): Promise<void> {
  console.log('\n🤖 Available Agents:\n');
  
  const agents = Orchestrator.getAvailableAgents();
  
  for (const agentName of agents) {
    // Create a temporary orchestrator to check availability
    const tempOrch = new Orchestrator({ repoPath: process.cwd() });
    tempOrch.addAgent(agentName);
    
    // We can't easily check without exposing it, but we can try to instantiate
    // For now, just list them
    console.log(`  • ${agentName}`);
  }
  
  console.log(`\nUse --agents <name1,name2,...> to specify which agents to use.`);
  console.log(`Example: swarm "fix bug" --agents claude,codex,gemini\n`);
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

async function main(): Promise<void> {
  const args = parseArgs();

  // Handle --list-agents
  if (args.listAgents) {
    await listAgents();
    return;
  }

  // Check synthesis availability (either API key or Claude CLI)
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasClaudeCli = await Synthesizer.isClaudeCliAvailable();
  
  if (!hasApiKey && !hasClaudeCli) {
    console.error('Error: No synthesis method available.');
    console.error('Either set ANTHROPIC_API_KEY or install the Claude CLI.');
    process.exit(1);
  }

  console.log(`\n🐝 SWARM starting...`);
  console.log(`Task: "${args.task}"`);
  console.log(`Agents: ${args.agents.join(', ')}`);
  console.log(`Repo: ${path.resolve(args.repoPath)}`);
  console.log(`Synthesis: ${hasApiKey ? 'Anthropic API' : 'Claude CLI'}`);
  console.log('');

  // Initialize orchestrator
  const orchestrator = new Orchestrator({
    repoPath: args.repoPath,
    verbose: args.verbose,
  });

  // Add agents
  try {
    orchestrator.addAgents(args.agents);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    // Execute agents in parallel
    console.log('🚀 Running agents in parallel...\n');
    const results = await orchestrator.execute(args.task);

    // Check if any agent succeeded
    const successCount = results.filter(r => r.success).length;
    console.log(`\n✓ Execution complete: ${successCount}/${results.length} agents succeeded`);

    // Only synthesize if we have results
    if (results.length > 0) {
      // Synthesize results
      console.log('🔬 Synthesizing results...');
      const synthesizer = new Synthesizer({ verbose: args.verbose });
      const synthesis = await synthesizer.synthesize(args.task, results);

      // Output results
      console.log('');
      if (args.outputFormat === 'json') {
        console.log(JSON.stringify(synthesis, null, 2));
      } else {
        console.log(formatTextOutput(synthesis));
      }
    } else {
      console.log('\n⚠️  No agent results to synthesize.');
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
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
