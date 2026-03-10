/**
 * Tool definitions for SDK-based agents
 * 
 * These are the tools that agents can use to perform coding tasks.
 * Same tools work for all providers (Claude, OpenAI, Gemini).
 */

// Tool definition in Anthropic format (others adapt from this)
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

/**
 * Core tools available to all agents
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { 
          type: 'string', 
          description: 'File path relative to the workspace root' 
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { 
          type: 'string', 
          description: 'File path relative to the workspace root' 
        },
        content: { 
          type: 'string', 
          description: 'Content to write to the file' 
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path. Returns entries with "/" suffix for directories.',
    input_schema: {
      type: 'object',
      properties: {
        path: { 
          type: 'string', 
          description: 'Directory path relative to the workspace root. Use "." for the root directory.' 
        }
      },
      required: ['path']
    }
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command in the workspace directory. Returns stdout/stderr. Use for running tests, installing packages, git commands, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { 
          type: 'string', 
          description: 'Shell command to execute' 
        }
      },
      required: ['command']
    }
  },
  {
    name: 'search_files',
    description: 'Search for files matching a pattern using glob. Returns list of matching file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { 
          type: 'string', 
          description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' 
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep',
    description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { 
          type: 'string', 
          description: 'Search pattern (regex)' 
        },
        path: { 
          type: 'string', 
          description: 'Directory or file to search in (default: current directory)' 
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'task_complete',
    description: 'Signal that the task is complete. Call this when you have finished all required changes.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { 
          type: 'string', 
          description: 'Summary of what was done to complete the task' 
        }
      },
      required: ['summary']
    }
  }
];

/**
 * Convert tools to OpenAI function format
 */
export function toOpenAITools(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition['input_schema'];
  };
}> {
  return AGENT_TOOLS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

// Gemini tools are generated directly in agent-loop.ts with proper types
