/**
 * Base agent interface and abstract class
 */

import { AgentResult, AgentConfig } from '../types.js';

/**
 * Interface that all agents must implement
 */
export interface Agent {
  readonly name: string;
  readonly config: AgentConfig;
  
  /**
   * Execute the agent with the given task in the specified worktree
   */
  execute(task: string, worktreePath: string, branchName: string): Promise<AgentResult>;
  
  /**
   * Check if the agent is available (CLI installed, etc.)
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Base class with common agent functionality
 */
export abstract class BaseAgent implements Agent {
  abstract readonly name: string;
  abstract readonly config: AgentConfig;

  abstract execute(task: string, worktreePath: string, branchName: string): Promise<AgentResult>;

  /**
   * Default availability check - can be overridden
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Create a basic result object
   */
  protected createResult(
    worktreePath: string,
    branchName: string,
    partial: Partial<AgentResult>
  ): AgentResult {
    return {
      agentName: this.name,
      worktreePath,
      branchName,
      success: false,
      output: '',
      durationMs: 0,
      filesChanged: [],
      diff: '',
      ...partial,
    };
  }
}

/**
 * Registry for available agents
 */
export class AgentRegistry {
  private static agents: Map<string, () => Agent> = new Map();

  static register(name: string, factory: () => Agent): void {
    this.agents.set(name.toLowerCase(), factory);
  }

  static get(name: string): Agent | undefined {
    const factory = this.agents.get(name.toLowerCase());
    return factory ? factory() : undefined;
  }

  static list(): string[] {
    return Array.from(this.agents.keys());
  }

  static has(name: string): boolean {
    return this.agents.has(name.toLowerCase());
  }
}
