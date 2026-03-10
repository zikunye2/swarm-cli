#!/usr/bin/env node

/**
 * swarm-cli - Multi-Agent Deliberation CLI
 * 
 * Runs coding tasks across multiple AI CLI agents in parallel,
 * then synthesizes conflicts for human decision.
 * 
 * Supports flexible model selection with provider:variant syntax
 * and multiple auth strategies (CLI or API).
 */

import { Orchestrator } from './orchestrator.js';
import { Synthesizer } from './synthesizer.js';
import { SynthesisResult } from './types.js';
import { loadConfig, mergeWithCliOptions, getConfigPath, validateModelSpec } from './config.js';
import { ProviderRegistry, listAllModels, isValidModelSpec } from './models/index.js';
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
}

async function parseArgs(): Promise<CliArgs> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
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

  // Validate model specs
  for (const agent of result.agents) {
    const validation = validateModelSpec(agent);
    if (!validation.valid) {
      console.error(`Error: ${validation.error}`);
      process.exit(1);
    }
  }

  const synthValidation = validateModelSpec(result.synthesizer);
  if (!synthValidation.valid) {
    console.error(`Error: ${synthValidation.error}`);
    process.exit(1);
  }

  return result;
}

function printHelp(): void {
  const availableModels = listAllModels().join(', ');
  const providers = ProviderRegistry.list().join(', ');
  
  console.log(`
swarm - Multi-Agent Deliberation CLI

Usage: swarm <task> [options]

Arguments:
  task                       The coding task to execute (required)

Options:
  -a, --agents <list>        Comma-separated list of agents/models
                             Format: provider:variant (e.g., claude:opus, gemini:pro)
                             Default: from config or 'claude'
                             
  -s, --synthesizer <model>  Model to use for synthesis
                             Format: provider:variant (e.g., claude:sonnet)
                             Default: from config or 'claude:sonnet'
                             
  -r, --repo <path>          Repository path (default: current directory)
  -v, --verbose              Enable verbose output
  --json                     Output synthesis as JSON
  --no-cleanup               Don't cleanup worktrees after execution
  --list-models              Show available models and their status
  --init                     Create default config file
  -h, --help                 Show this help message

Available Providers: ${providers}
Available Models: ${availableModels}

Examples:
  swarm "add input validation to user forms"
  swarm "refactor auth" --agents claude:opus,gemini:pro
  swarm "add tests" --agents claude:sonnet,codex --synthesizer claude:opus
  swarm "fix bug" --verbose --json

Configuration:
  Config file: ~/.swarm/config.json
  
  The config file can set defaults for agents, synthesizer, and auth methods.
  Run 'swarm --init' to create a default config file.
  
  Environment variables:
    ANTHROPIC_API_KEY    - For Claude API auth
    OPENAI_API_KEY       - For OpenAI/Codex API auth  
    GEMINI_API_KEY       - For Gemini API auth
    SWARM_AGENTS         - Override default agents
    SWARM_SYNTHESIZER    - Override default synthesizer

Auth Modes:
  Each provider supports CLI auth (subscription-based, no API key needed)
  or API auth (requires API key). The tool auto-detects based on available
  API keys, or you can configure in ~/.swarm/config.json.
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
  const { initConfig } = await import('./config.js');
  await initConfig();
  console.log(`\nConfig initialized at ${getConfigPath()}`);
  console.log('Edit this file to customize default agents, synthesizer, and auth methods.');
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

  // Check synthesis availability
  const synthAvailable = await Synthesizer.isAvailable(args.synthesizer);
  
  if (!synthAvailable) {
    console.error(`Error: Synthesizer model '${args.synthesizer}' is not available.`);
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

  // Add agents
  try {
    await orchestrator.addAgents(args.agents);
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
      const synthesizer = new Synthesizer({ 
        model: args.synthesizer,
        verbose: args.verbose 
      });
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
