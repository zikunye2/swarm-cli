#!/usr/bin/env node

/**
 * swarm-cli - Multi-Agent Deliberation CLI
 * 
 * Phase 1: Simple CLI with console.log output
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
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const result: CliArgs = {
    task: '',
    agents: ['claude'], // Default to Claude agent
    repoPath: process.cwd(),
    verbose: false,
    outputFormat: 'text',
    cleanup: true,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--agents' || arg === '-a') {
      result.agents = args[++i]?.split(',') || ['claude'];
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
  console.log(`
swarm - Multi-Agent Deliberation CLI

Usage: swarm <task> [options]

Arguments:
  task                    The coding task to execute (required)

Options:
  -a, --agents <list>     Comma-separated list of agents (default: claude)
  -r, --repo <path>       Repository path (default: current directory)
  -v, --verbose           Enable verbose output
  --json                  Output synthesis as JSON
  --no-cleanup            Don't cleanup worktrees after execution
  -h, --help              Show this help message

Examples:
  swarm "add input validation to user forms"
  swarm "refactor the authentication module" --agents claude
  swarm "add unit tests" --verbose --json

Environment:
  ANTHROPIC_API_KEY       Required for synthesis (Claude API)
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

async function main(): Promise<void> {
  const args = parseArgs();

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log(`\n🐝 SWARM starting...`);
  console.log(`Task: "${args.task}"`);
  console.log(`Agents: ${args.agents.join(', ')}`);
  console.log(`Repo: ${path.resolve(args.repoPath)}`);
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
    console.log('🚀 Running agents in parallel...');
    const results = await orchestrator.execute(args.task);

    // Check if any agent succeeded
    const successCount = results.filter(r => r.success).length;
    console.log(`\n✓ Execution complete: ${successCount}/${results.length} agents succeeded`);

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
