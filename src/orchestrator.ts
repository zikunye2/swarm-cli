/**
 * Orchestrator - manages parallel agent execution
 */

import { WorktreeManager } from './worktree.js';
import { Agent, AgentRegistry } from './agents/base.js';
import { AgentResult, TaskConfig } from './types.js';
import { ClaudeAgent } from './agents/claude.js';

// Ensure Claude agent is registered
new ClaudeAgent();

export interface OrchestratorOptions {
  repoPath: string;
  baseBranch?: string;
  timeout?: number;
  verbose?: boolean;
}

export class Orchestrator {
  private worktreeManager: WorktreeManager;
  private options: OrchestratorOptions;
  private agents: Agent[] = [];

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
   * Execute task across all agents in parallel
   */
  async execute(task: string): Promise<AgentResult[]> {
    if (this.agents.length === 0) {
      throw new Error('No agents configured. Add at least one agent before executing.');
    }

    this.log(`Starting parallel execution with ${this.agents.length} agent(s)...`);
    this.log(`Task: "${task}"`);

    // Check agent availability
    await this.checkAgentAvailability();

    // Create worktrees for each agent
    this.log('Creating worktrees...');
    const worktrees = await Promise.all(
      this.agents.map(async (agent) => {
        const worktree = await this.worktreeManager.createWorktree(
          agent.name,
          this.options.baseBranch
        );
        this.log(`  Created worktree for ${agent.name}: ${worktree.path}`);
        return { agent, worktree };
      })
    );

    // Execute all agents in parallel
    this.log('Executing agents in parallel...');
    const startTime = Date.now();

    const results = await Promise.all(
      worktrees.map(async ({ agent, worktree }) => {
        this.log(`  Starting ${agent.name}...`);
        const result = await agent.execute(task, worktree.path, worktree.branch);
        this.log(`  ${agent.name} completed in ${(result.durationMs / 1000).toFixed(1)}s`);
        return result;
      })
    );

    const totalTime = Date.now() - startTime;
    this.log(`All agents completed in ${(totalTime / 1000).toFixed(1)}s`);

    return results;
  }

  /**
   * Check if all agents are available
   */
  private async checkAgentAvailability(): Promise<void> {
    const availability = await Promise.all(
      this.agents.map(async (agent) => ({
        name: agent.name,
        available: await agent.isAvailable(),
      }))
    );

    const unavailable = availability.filter((a) => !a.available);
    if (unavailable.length > 0) {
      throw new Error(
        `The following agents are not available: ${unavailable.map((a) => a.name).join(', ')}`
      );
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
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[swarm] ${message}`);
    }
  }
}

export default Orchestrator;
