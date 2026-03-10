/**
 * Orchestrator - manages parallel agent execution with progress display
 */

import { WorktreeManager } from './worktree.js';
import { Agent, AgentRegistry } from './agents/base.js';
import { AgentResult, TaskConfig } from './types.js';
import { ClaudeAgent } from './agents/claude.js';
import { CodexAgent } from './agents/codex.js';
import { GeminiAgent } from './agents/gemini.js';

// Ensure agents are registered
new ClaudeAgent();
new CodexAgent();
new GeminiAgent();

export interface OrchestratorOptions {
  repoPath: string;
  baseBranch?: string;
  timeout?: number;
  verbose?: boolean;
}

interface AgentProgress {
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
  startTime?: number;
  endTime?: number;
  error?: string;
}

export class Orchestrator {
  private worktreeManager: WorktreeManager;
  private options: OrchestratorOptions;
  private agents: Agent[] = [];
  private progress: Map<string, AgentProgress> = new Map();
  private progressInterval?: NodeJS.Timeout;

  constructor(options: OrchestratorOptions) {
    this.options = {
      baseBranch: 'main',
      timeout: 300000,
      verbose: false,
      ...options,
    };
    this.worktreeManager = new WorktreeManager(options.repoPath);
  }

  /**
   * Add an agent to the orchestration
   */
  addAgent(agentName: string): void {
    const agent = AgentRegistry.get(agentName);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${AgentRegistry.list().join(', ')}`);
    }
    this.agents.push(agent);
    this.progress.set(agentName, { agentName, status: 'pending' });
  }

  /**
   * Add multiple agents
   */
  addAgents(agentNames: string[]): void {
    for (const name of agentNames) {
      this.addAgent(name);
    }
  }

  /**
   * Execute task across all agents in parallel with progress display
   */
  async execute(task: string): Promise<AgentResult[]> {
    if (this.agents.length === 0) {
      throw new Error('No agents configured. Add at least one agent before executing.');
    }

    this.log(`Starting parallel execution with ${this.agents.length} agent(s)...`);
    this.log(`Task: "${task}"`);

    // Check agent availability
    const availableAgents = await this.checkAgentAvailability();
    
    if (availableAgents.length === 0) {
      throw new Error('No agents are available. Please install at least one agent CLI.');
    }

    // Create worktrees for each available agent
    this.log('Creating worktrees...');
    const worktrees = await Promise.all(
      availableAgents.map(async (agent) => {
        const worktree = await this.worktreeManager.createWorktree(
          agent.name,
          this.options.baseBranch
        );
        this.log(`  Created worktree for ${agent.name}: ${worktree.path}`);
        return { agent, worktree };
      })
    );

    // Start progress display
    this.startProgressDisplay();

    // Execute all agents in parallel
    this.log('Executing agents in parallel...');
    const startTime = Date.now();

    const results = await Promise.all(
      worktrees.map(async ({ agent, worktree }) => {
        this.updateProgress(agent.name, { status: 'running', startTime: Date.now() });
        
        try {
          const result = await agent.execute(task, worktree.path, worktree.branch);
          this.updateProgress(agent.name, {
            status: result.success ? 'completed' : 'failed',
            endTime: Date.now(),
            error: result.error,
          });
          return result;
        } catch (err) {
          this.updateProgress(agent.name, {
            status: 'failed',
            endTime: Date.now(),
            error: (err as Error).message,
          });
          throw err;
        }
      })
    );

    // Stop progress display
    this.stopProgressDisplay();

    const totalTime = Date.now() - startTime;
    this.log(`All agents completed in ${(totalTime / 1000).toFixed(1)}s`);

    // Print final status
    this.printFinalStatus();

    return results;
  }

  /**
   * Check if all agents are available, return only available ones
   */
  private async checkAgentAvailability(): Promise<Agent[]> {
    const availability = await Promise.all(
      this.agents.map(async (agent) => ({
        agent,
        available: await agent.isAvailable(),
      }))
    );

    const unavailable = availability.filter((a) => !a.available);
    const available = availability.filter((a) => a.available).map((a) => a.agent);
    
    // Mark unavailable agents
    for (const { agent } of unavailable) {
      this.updateProgress(agent.name, { status: 'unavailable' });
      console.log(`⚠️  Agent '${agent.name}' is not installed, skipping...`);
    }

    return available;
  }

  /**
   * Update progress for an agent
   */
  private updateProgress(agentName: string, update: Partial<AgentProgress>): void {
    const current = this.progress.get(agentName) || { agentName, status: 'pending' };
    this.progress.set(agentName, { ...current, ...update });
  }

  /**
   * Start the progress display interval
   */
  private startProgressDisplay(): void {
    if (!this.options.verbose) {
      // Clear any existing interval
      this.stopProgressDisplay();
      
      // Update progress every 500ms
      this.progressInterval = setInterval(() => {
        this.displayProgress();
      }, 500);
    }
  }

  /**
   * Stop the progress display
   */
  private stopProgressDisplay(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      // Clear the progress line
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }
  }

  /**
   * Display current progress inline
   */
  private displayProgress(): void {
    const statusParts: string[] = [];
    
    for (const [name, prog] of this.progress) {
      let symbol: string;
      let elapsed = '';
      
      switch (prog.status) {
        case 'pending':
          symbol = '⏳';
          break;
        case 'running':
          symbol = '🔄';
          if (prog.startTime) {
            const secs = Math.floor((Date.now() - prog.startTime) / 1000);
            elapsed = ` ${secs}s`;
          }
          break;
        case 'completed':
          symbol = '✅';
          break;
        case 'failed':
          symbol = '❌';
          break;
        case 'unavailable':
          symbol = '⚫';
          break;
        default:
          symbol = '?';
      }
      
      statusParts.push(`${symbol} ${name}${elapsed}`);
    }
    
    const line = statusParts.join('  │  ');
    process.stdout.write(`\r${line}`);
  }

  /**
   * Print final status summary
   */
  private printFinalStatus(): void {
    console.log('\n');
    console.log('Agent Status:');
    
    for (const [name, prog] of this.progress) {
      let line: string;
      
      switch (prog.status) {
        case 'completed': {
          const duration = prog.startTime && prog.endTime 
            ? ((prog.endTime - prog.startTime) / 1000).toFixed(1) + 's'
            : '';
          line = `  ✅ ${name}: completed ${duration}`;
          break;
        }
        case 'failed': {
          const duration = prog.startTime && prog.endTime 
            ? ((prog.endTime - prog.startTime) / 1000).toFixed(1) + 's'
            : '';
          line = `  ❌ ${name}: failed ${duration}`;
          if (prog.error) {
            line += ` - ${prog.error.slice(0, 50)}`;
          }
          break;
        }
        case 'unavailable':
          line = `  ⚫ ${name}: not installed`;
          break;
        default:
          line = `  ⏳ ${name}: ${prog.status}`;
      }
      
      console.log(line);
    }
  }

  /**
   * Cleanup all worktrees created by this orchestrator
   */
  async cleanup(): Promise<void> {
    this.log('Cleaning up worktrees...');
    const worktrees = this.worktreeManager.getTrackedWorktrees();
    
    for (const worktree of worktrees) {
      await this.worktreeManager.removeWorktree(worktree.path);
      this.log(`  Removed ${worktree.path}`);
    }
  }

  /**
   * Cleanup ALL swarm worktrees (not just this session)
   */
  async cleanupAll(): Promise<void> {
    this.log('Cleaning up all swarm worktrees...');
    await this.worktreeManager.cleanupAll();
  }

  /**
   * Get the worktree manager for advanced operations
   */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }

  /**
   * Get list of available agents (registered)
   */
  static getAvailableAgents(): string[] {
    return AgentRegistry.list();
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[swarm] ${message}`);
    }
  }
}

export default Orchestrator;
