/**
 * Agent Loop - Unified agent execution loop for all providers
 * 
 * This module implements the core agent loop that handles tool calling
 * for Claude, OpenAI, and Gemini providers using their respective SDKs.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI, Part, SchemaType, FunctionDeclaration } from '@google/generative-ai';
import { AGENT_TOOLS, toOpenAITools } from './tools/index.js';
import { executeTool } from './tools/executor.js';

// ============================================================================
// Types
// ============================================================================

export type ProviderType = 'claude' | 'openai' | 'gemini';

export interface AgentLoopParams {
  provider: ProviderType;
  model: string;
  task: string;
  workdir: string;
  maxIterations?: number;
  verbose?: boolean;
  // Provider-specific clients
  claudeClient?: Anthropic;
  openaiClient?: OpenAI;
  geminiClient?: GoogleGenerativeAI;
}

export interface AgentLoopResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  toolCalls: number;
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(): string {
  return `You are an expert software developer working on a coding task. You have access to tools to read/write files, execute commands, and complete tasks.

Your approach:
1. First, explore the codebase to understand the structure and context
2. Plan your changes carefully
3. Implement the changes using the provided tools
4. Verify your changes work correctly (run tests if applicable)
5. Call task_complete when done

Guidelines:
- Be thorough but efficient
- Follow existing code patterns and conventions
- Write clean, maintainable code
- Test your changes when possible
- Do NOT commit - changes will be committed automatically

When you have completed all required changes, call the task_complete tool with a summary of what you did.`;
}

function buildUserPrompt(task: string): string {
  return `Complete the following task:

${task}

Start by exploring the codebase structure, then implement the required changes.`;
}

// ============================================================================
// Claude Agent Loop
// ============================================================================

async function runClaudeLoop(params: {
  client: Anthropic;
  model: string;
  task: string;
  workdir: string;
  maxIterations: number;
  verbose: boolean;
}): Promise<AgentLoopResult> {
  const { client, model, task, workdir, maxIterations, verbose } = params;
  
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(task) }
  ];
  
  let iterations = 0;
  let totalToolCalls = 0;
  let lastAssistantText = '';

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    
    if (verbose) {
      console.log(`[claude] Iteration ${iterations}...`);
    }

    // Call Claude with tools
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: buildSystemPrompt(),
      tools: AGENT_TOOLS as Anthropic.Messages.Tool[],
      messages,
    });

    // Extract text content
    const textContent = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    
    if (textContent) {
      lastAssistantText = textContent;
    }

    // Check for tool use
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls - model is done
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    totalToolCalls += toolUseBlocks.length;

    // Execute tool calls
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    let taskCompleted = false;
    let completionSummary = '';

    for (const toolUse of toolUseBlocks) {
      if (verbose) {
        console.log(`[claude] Tool: ${toolUse.name}`);
      }

      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        workdir
      );

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.result,
        is_error: result.error,
      });

      if (result.done) {
        taskCompleted = true;
        completionSummary = result.result;
      }
    }

    // Add assistant message and tool results
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    if (taskCompleted) {
      return {
        success: true,
        output: completionSummary || lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    // Check stop reason
    if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }
  }

  return {
    success: false,
    output: lastAssistantText,
    error: 'Max iterations reached without task completion',
    iterations,
    toolCalls: totalToolCalls,
  };
}

// ============================================================================
// OpenAI Agent Loop
// ============================================================================

async function runOpenAILoop(params: {
  client: OpenAI;
  model: string;
  task: string;
  workdir: string;
  maxIterations: number;
  verbose: boolean;
}): Promise<AgentLoopResult> {
  const { client, model, task, workdir, maxIterations, verbose } = params;
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(task) }
  ];
  
  let iterations = 0;
  let totalToolCalls = 0;
  let lastAssistantText = '';

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    
    if (verbose) {
      console.log(`[openai] Iteration ${iterations}...`);
    }

    // Call OpenAI with tools
    const response = await client.chat.completions.create({
      model,
      max_tokens: 8192,
      tools: toOpenAITools(),
      messages,
    });

    const choice = response.choices[0];
    if (!choice) {
      return {
        success: false,
        output: lastAssistantText,
        error: 'No response from OpenAI',
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    const message = choice.message;
    
    if (message.content) {
      lastAssistantText = message.content;
    }

    // Check for tool calls
    const toolCalls = message.tool_calls || [];

    if (toolCalls.length === 0) {
      // No tool calls - model is done
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    totalToolCalls += toolCalls.length;

    // Add assistant message
    messages.push(message);

    // Execute tool calls and add results
    let taskCompleted = false;
    let completionSummary = '';

    for (const toolCall of toolCalls) {
      // Handle both standard and custom tool calls
      const funcCall = 'function' in toolCall ? toolCall.function : null;
      if (!funcCall) continue;

      if (verbose) {
        console.log(`[openai] Tool: ${funcCall.name}`);
      }

      const input = JSON.parse(funcCall.arguments);
      const result = await executeTool(funcCall.name, input, workdir);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.result,
      });

      if (result.done) {
        taskCompleted = true;
        completionSummary = result.result;
      }
    }

    if (taskCompleted) {
      return {
        success: true,
        output: completionSummary || lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    // Check finish reason
    if (choice.finish_reason === 'stop') {
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }
  }

  return {
    success: false,
    output: lastAssistantText,
    error: 'Max iterations reached without task completion',
    iterations,
    toolCalls: totalToolCalls,
  };
}

// ============================================================================
// Gemini Agent Loop
// ============================================================================

/**
 * Convert tools to Gemini-compatible function declarations
 */
function toGeminiFunctionDeclarations(): FunctionDeclaration[] {
  return AGENT_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        Object.entries(tool.input_schema.properties).map(([key, value]) => [
          key,
          {
            type: SchemaType.STRING,
            description: value.description,
          },
        ])
      ),
      required: tool.input_schema.required,
    },
  })) as FunctionDeclaration[];
}

async function runGeminiLoop(params: {
  client: GoogleGenerativeAI;
  model: string;
  task: string;
  workdir: string;
  maxIterations: number;
  verbose: boolean;
}): Promise<AgentLoopResult> {
  const { client, model: modelName, task, workdir, maxIterations, verbose } = params;
  
  // Create model with tools
  const model = client.getGenerativeModel({
    model: modelName,
    tools: [{
      functionDeclarations: toGeminiFunctionDeclarations(),
    }],
    systemInstruction: buildSystemPrompt(),
  });

  // Start chat
  const chat = model.startChat();
  
  let iterations = 0;
  let totalToolCalls = 0;
  let lastAssistantText = '';

  // Send initial message
  let result = await chat.sendMessage(buildUserPrompt(task));

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    
    if (verbose) {
      console.log(`[gemini] Iteration ${iterations}...`);
    }

    const response = result.response;
    const candidate = response.candidates?.[0];
    
    if (!candidate) {
      return {
        success: false,
        output: lastAssistantText,
        error: 'No response from Gemini',
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    // Extract text parts
    const textParts = candidate.content.parts
      .filter((part): part is Part & { text: string } => 'text' in part)
      .map(part => part.text);
    
    if (textParts.length > 0) {
      lastAssistantText = textParts.join('\n');
    }

    // Check for function calls
    const functionCalls = candidate.content.parts
      .filter((part): part is Part & { functionCall: { name: string; args: Record<string, unknown> } } => 
        'functionCall' in part
      );

    if (functionCalls.length === 0) {
      // No function calls - model is done
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    totalToolCalls += functionCalls.length;

    // Execute function calls
    const functionResponses: Part[] = [];
    let taskCompleted = false;
    let completionSummary = '';

    for (const fc of functionCalls) {
      if (verbose) {
        console.log(`[gemini] Tool: ${fc.functionCall.name}`);
      }

      const toolResult = await executeTool(
        fc.functionCall.name,
        fc.functionCall.args,
        workdir
      );

      functionResponses.push({
        functionResponse: {
          name: fc.functionCall.name,
          response: { result: toolResult.result },
        },
      });

      if (toolResult.done) {
        taskCompleted = true;
        completionSummary = toolResult.result;
      }
    }

    if (taskCompleted) {
      return {
        success: true,
        output: completionSummary || lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }

    // Send function responses
    result = await chat.sendMessage(functionResponses);

    // Check finish reason
    if (candidate.finishReason === 'STOP') {
      return {
        success: true,
        output: lastAssistantText,
        iterations,
        toolCalls: totalToolCalls,
      };
    }
  }

  return {
    success: false,
    output: lastAssistantText,
    error: 'Max iterations reached without task completion',
    iterations,
    toolCalls: totalToolCalls,
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run the agent loop with the specified provider
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { 
    provider, 
    model, 
    task, 
    workdir, 
    maxIterations = 30,
    verbose = false,
    claudeClient,
    openaiClient,
    geminiClient,
  } = params;

  switch (provider) {
    case 'claude': {
      if (!claudeClient) {
        throw new Error('Claude client not provided');
      }
      return runClaudeLoop({
        client: claudeClient,
        model,
        task,
        workdir,
        maxIterations,
        verbose,
      });
    }

    case 'openai': {
      if (!openaiClient) {
        throw new Error('OpenAI client not provided');
      }
      return runOpenAILoop({
        client: openaiClient,
        model,
        task,
        workdir,
        maxIterations,
        verbose,
      });
    }

    case 'gemini': {
      if (!geminiClient) {
        throw new Error('Gemini client not provided');
      }
      return runGeminiLoop({
        client: geminiClient,
        model,
        task,
        workdir,
        maxIterations,
        verbose,
      });
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
