/**
 * Synthesizer - analyzes agent outputs and identifies conflicts
 * 
 * THIS IS THE MOST CRITICAL PART OF SWARM-CLI
 * The quality of conflict analysis determines the product's value
 * 
 * Supports two modes:
 * 1. Direct API (requires ANTHROPIC_API_KEY)
 * 2. Claude CLI fallback (uses `claude` command)
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import {
  AgentResult,
  SynthesisResult,
  AgentSummary,
  FileConflict,
  Recommendation,
} from './types.js';

export interface SynthesizerOptions {
  model?: string;
  maxTokens?: number;
  verbose?: boolean;
  useClaudeCli?: boolean; // Force Claude CLI mode
}

export class Synthesizer {
  private client: Anthropic | null = null;
  private options: SynthesizerOptions;
  private useClaudeCli: boolean;

  constructor(options: SynthesizerOptions = {}) {
    this.options = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      verbose: false,
      useClaudeCli: false,
      ...options,
    };

    // Determine if we should use Claude CLI or API
    this.useClaudeCli = options.useClaudeCli || !process.env.ANTHROPIC_API_KEY;

    if (!this.useClaudeCli) {
      // Initialize Anthropic client (uses ANTHROPIC_API_KEY env var)
      try {
        this.client = new Anthropic();
      } catch (err) {
        this.log('Failed to initialize Anthropic client, falling back to Claude CLI');
        this.useClaudeCli = true;
      }
    }

    if (this.useClaudeCli) {
      this.log('Using Claude CLI for synthesis (no API key required)');
    } else {
      this.log('Using Anthropic API for synthesis');
    }
  }

  /**
   * Synthesize results from multiple agents
   */
  async synthesize(task: string, results: AgentResult[]): Promise<SynthesisResult> {
    this.log(`Synthesizing results from ${results.length} agent(s)...`);

    // Build the analysis prompt
    const prompt = this.buildAnalysisPrompt(task, results);

    let analysisText: string;

    if (this.useClaudeCli) {
      analysisText = await this.callClaudeCli(prompt);
    } else {
      analysisText = await this.callAnthropicApi(prompt);
    }

    // Parse the structured response
    const synthesis = this.parseAnalysis(task, results, analysisText);

    this.log('Synthesis complete.');
    return synthesis;
  }

  /**
   * Call Claude via direct API
   */
  private async callAnthropicApi(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const response = await this.client.messages.create({
      model: this.options.model!,
      max_tokens: this.options.maxTokens!,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * Call Claude via CLI as fallback
   */
  private async callClaudeCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      // Use claude CLI in print mode
      const proc = spawn('claude', ['-p', prompt], {
        shell: true,
        stdio: 'pipe',
        env: process.env,
      });

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // 5 minute timeout for synthesis
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Claude CLI synthesis timed out'));
      }, 300000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
      });
    });
  }

  /**
   * Check if Claude CLI is available
   */
  static async isClaudeCliAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['claude'], {
        shell: true,
        stdio: 'pipe',
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Build the analysis prompt - THE CRITICAL PART
   * 
   * This prompt must:
   * 1. Clearly present each agent's changes
   * 2. Ask for specific, actionable conflict identification
   * 3. Request recommendations with clear reasoning
   */
  private buildAnalysisPrompt(task: string, results: AgentResult[]): string {
    const agentDiffs = results.map((r) => this.formatAgentResult(r)).join('\n\n---\n\n');

    return `You are an expert code reviewer analyzing the outputs of multiple AI coding agents that worked on the same task independently. Your job is to identify conflicts, compare approaches, and provide actionable recommendations.

## TASK THAT WAS GIVEN TO AGENTS
${task}

## AGENT RESULTS

${agentDiffs}

## YOUR ANALYSIS

Analyze the agent outputs and provide a structured analysis in the following JSON format. Be thorough and specific.

\`\`\`json
{
  "agentSummaries": [
    {
      "agentName": "agent name",
      "success": true/false,
      "approach": "Brief description of the agent's overall approach and methodology",
      "filesChanged": ["list", "of", "files"],
      "keyChanges": ["Specific change 1", "Specific change 2"],
      "strengths": ["What this agent did well"],
      "weaknesses": ["What could be improved or concerning aspects"]
    }
  ],
  "conflicts": [
    {
      "filePath": "path/to/file",
      "conflictType": "different_changes|one_modified_one_not|both_added|both_deleted",
      "severity": "high|medium|low",
      "description": "Clear explanation of what the conflict is",
      "agents": [
        {
          "agentName": "name",
          "change": "added|modified|deleted",
          "summary": "What this agent did to this file"
        }
      ]
    }
  ],
  "recommendations": [
    {
      "filePath": "path/to/file or 'general'",
      "recommendation": "Specific actionable recommendation",
      "preferredAgent": "agent name or null",
      "reasoning": "Why this recommendation makes sense",
      "manualReviewNeeded": true/false
    }
  ],
  "overallAssessment": "A paragraph summarizing the overall situation, which agent(s) performed better, and the recommended path forward",
  "suggestedMergeOrder": ["agent1", "agent2"] // Order to merge if doing sequential merges
}
\`\`\`

### CONFLICT DETECTION GUIDELINES

**High Severity Conflicts:**
- Same function/method modified differently by multiple agents
- Conflicting business logic implementations
- Incompatible API changes
- Security-related disagreements

**Medium Severity Conflicts:**
- Different but potentially compatible approaches to the same problem
- Style/formatting differences in logic-heavy code
- Different test implementations that could coexist

**Low Severity Conflicts:**
- Pure formatting/style differences
- Comment differences
- Import ordering
- Whitespace changes

### IMPORTANT NOTES

1. If agents made no changes or failed, note that clearly
2. If there are NO conflicts, say so explicitly - don't invent conflicts
3. Be specific about file paths and line-level changes when possible
4. Consider semantic conflicts, not just textual conflicts
5. Think about whether changes are complementary or contradictory

Respond ONLY with the JSON object, no additional text.`;
  }

  /**
   * Format a single agent's result for the prompt
   */
  private formatAgentResult(result: AgentResult): string {
    const statusEmoji = result.success ? '✅' : '❌';
    const filesSection = result.filesChanged.length > 0
      ? `Files Changed: ${result.filesChanged.join(', ')}`
      : 'Files Changed: None';

    return `### AGENT: ${result.agentName} ${statusEmoji}

**Status:** ${result.success ? 'Success' : 'Failed'}
**Duration:** ${(result.durationMs / 1000).toFixed(1)}s
**${filesSection}**

${result.error ? `**Error:** ${result.error}\n\n` : ''}**Agent Output:**
\`\`\`
${result.output.slice(0, 3000)}${result.output.length > 3000 ? '\n... (truncated)' : ''}
\`\`\`

**Git Diff:**
\`\`\`diff
${result.diff.slice(0, 5000)}${result.diff.length > 5000 ? '\n... (truncated)' : ''}
\`\`\``;
  }

  /**
   * Parse the Claude API response into structured data
   */
  private parseAnalysis(
    task: string,
    results: AgentResult[],
    analysisText: string
  ): SynthesisResult {
    // Extract JSON from the response
    const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      analysisText.match(/\{[\s\S]*\}/);
    
    let parsed: any;
    try {
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : analysisText;
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      // If parsing fails, create a basic structure from the raw text
      this.log('Warning: Failed to parse JSON response, creating basic structure');
      return this.createBasicSynthesis(task, results, analysisText);
    }

    // Map to our types with validation
    const agentResults: AgentSummary[] = (parsed.agentSummaries || []).map((s: any) => ({
      agentName: s.agentName || 'unknown',
      success: s.success ?? false,
      approach: s.approach || '',
      filesChanged: s.filesChanged || [],
      keyChanges: s.keyChanges || [],
      strengths: s.strengths || [],
      weaknesses: s.weaknesses || [],
    }));

    const conflicts: FileConflict[] = (parsed.conflicts || []).map((c: any) => ({
      filePath: c.filePath || '',
      conflictType: c.conflictType || 'different_changes',
      severity: c.severity || 'medium',
      description: c.description || '',
      agents: (c.agents || []).map((a: any) => ({
        agentName: a.agentName || 'unknown',
        change: a.change || 'modified',
        content: a.content,
        diff: a.diff,
      })),
    }));

    const recommendations: Recommendation[] = (parsed.recommendations || []).map((r: any) => ({
      filePath: r.filePath || 'general',
      recommendation: r.recommendation || '',
      preferredAgent: r.preferredAgent || undefined,
      reasoning: r.reasoning || '',
      manualReviewNeeded: r.manualReviewNeeded ?? true,
    }));

    return {
      task,
      timestamp: new Date().toISOString(),
      agentResults,
      conflicts,
      recommendations,
      overallAssessment: parsed.overallAssessment || '',
      suggestedMergeOrder: parsed.suggestedMergeOrder,
    };
  }

  /**
   * Create a basic synthesis when JSON parsing fails
   */
  private createBasicSynthesis(
    task: string,
    results: AgentResult[],
    rawText: string
  ): SynthesisResult {
    return {
      task,
      timestamp: new Date().toISOString(),
      agentResults: results.map((r) => ({
        agentName: r.agentName,
        success: r.success,
        approach: 'Unable to parse detailed analysis',
        filesChanged: r.filesChanged,
        keyChanges: [],
        strengths: [],
        weaknesses: [],
      })),
      conflicts: [],
      recommendations: [
        {
          filePath: 'general',
          recommendation: 'Manual review required - synthesis parsing failed',
          reasoning: rawText.slice(0, 500),
          manualReviewNeeded: true,
        },
      ],
      overallAssessment: rawText.slice(0, 1000),
    };
  }

  /**
   * Log if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[synthesizer] ${message}`);
    }
  }
}

export default Synthesizer;
