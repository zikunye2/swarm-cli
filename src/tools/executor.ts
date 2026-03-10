/**
 * Tool executor for SDK-based agents
 * 
 * Executes tool calls in the workspace directory.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolResult {
  result: string;
  done?: boolean;
  error?: boolean;
}

/**
 * Execute a tool call
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workdir: string
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_file': {
        const filePath = input.path as string;
        const fullPath = path.resolve(workdir, filePath);
        
        // Security: ensure path is within workdir
        if (!fullPath.startsWith(path.resolve(workdir))) {
          return { result: `Error: Path "${filePath}" is outside the workspace`, error: true };
        }
        
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          return { result: content };
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            return { result: `Error: File not found: ${filePath}`, error: true };
          }
          throw err;
        }
      }

      case 'write_file': {
        const filePath = input.path as string;
        const content = input.content as string;
        const fullPath = path.resolve(workdir, filePath);
        
        // Security: ensure path is within workdir
        if (!fullPath.startsWith(path.resolve(workdir))) {
          return { result: `Error: Path "${filePath}" is outside the workspace`, error: true };
        }
        
        // Create parent directories if needed
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return { result: `Successfully wrote ${content.length} characters to ${filePath}` };
      }

      case 'list_directory': {
        const dirPath = input.path as string || '.';
        const fullPath = path.resolve(workdir, dirPath);
        
        // Security: ensure path is within workdir
        if (!fullPath.startsWith(path.resolve(workdir))) {
          return { result: `Error: Path "${dirPath}" is outside the workspace`, error: true };
        }
        
        try {
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const list = entries
            .map(e => e.isDirectory() ? `${e.name}/` : e.name)
            .sort((a, b) => {
              // Directories first, then files
              const aIsDir = a.endsWith('/');
              const bIsDir = b.endsWith('/');
              if (aIsDir && !bIsDir) return -1;
              if (!aIsDir && bIsDir) return 1;
              return a.localeCompare(b);
            });
          return { result: list.join('\n') || '(empty directory)' };
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            return { result: `Error: Directory not found: ${dirPath}`, error: true };
          }
          throw err;
        }
      }

      case 'execute_command': {
        const command = input.command as string;
        
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workdir,
            encoding: 'utf-8',
            timeout: 60000, // 60 second timeout
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          });
          
          let result = '';
          if (stdout) result += stdout;
          if (stderr) result += (result ? '\n' : '') + `stderr: ${stderr}`;
          return { result: result || '(no output)' };
        } catch (err: any) {
          // execAsync throws on non-zero exit code
          let result = '';
          if (err.stdout) result += err.stdout;
          if (err.stderr) result += (result ? '\n' : '') + `stderr: ${err.stderr}`;
          if (err.message && !result) result = `Error: ${err.message}`;
          return { result, error: true };
        }
      }

      case 'search_files': {
        const pattern = input.pattern as string;
        
        try {
          // Use find for simple glob matching
          // Convert glob to find pattern
          const { stdout } = await execAsync(
            `find . -type f -name "${pattern.replace(/\*\*/g, '*')}" 2>/dev/null | head -100`,
            { cwd: workdir, encoding: 'utf-8' }
          );
          
          // If that doesn't work well, try git ls-files for tracked files
          if (!stdout.trim()) {
            try {
              const { stdout: gitStdout } = await execAsync(
                `git ls-files "${pattern}" 2>/dev/null | head -100`,
                { cwd: workdir, encoding: 'utf-8' }
              );
              return { result: gitStdout.trim() || '(no files found)' };
            } catch {
              return { result: '(no files found)' };
            }
          }
          
          return { result: stdout.trim() || '(no files found)' };
        } catch (err: any) {
          return { result: `Error searching files: ${err.message}`, error: true };
        }
      }

      case 'grep': {
        const pattern = input.pattern as string;
        const searchPath = (input.path as string) || '.';
        
        try {
          const { stdout } = await execAsync(
            `grep -rn "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`,
            { cwd: workdir, encoding: 'utf-8' }
          );
          return { result: stdout.trim() || '(no matches found)' };
        } catch (err: any) {
          // grep returns exit code 1 when no matches found
          if (err.code === 1) {
            return { result: '(no matches found)' };
          }
          return { result: `Error: ${err.message}`, error: true };
        }
      }

      case 'task_complete': {
        const summary = input.summary as string;
        return { result: summary, done: true };
      }

      default:
        return { result: `Unknown tool: ${name}`, error: true };
    }
  } catch (err: any) {
    return { result: `Error executing ${name}: ${err.message}`, error: true };
  }
}

/**
 * Execute multiple tool calls in parallel
 */
export async function executeToolCalls(
  toolCalls: Array<{ name: string; input: Record<string, unknown>; id?: string }>,
  workdir: string
): Promise<Array<{ id?: string; result: ToolResult }>> {
  return Promise.all(
    toolCalls.map(async (call) => ({
      id: call.id,
      result: await executeTool(call.name, call.input, workdir),
    }))
  );
}
