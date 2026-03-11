/**
 * Slash command registry for the REPL.
 *
 * Handles /help, /config, /models, /agents, /quit etc.
 */

export interface SlashHandler {
  name: string;
  description: string;
  handler: (args: string) => Promise<string>;
}

export interface ParsedInput {
  isSlash: boolean;
  command?: string;
  args?: string;
}

export class SlashCommandRegistry {
  private commands = new Map<string, SlashHandler>();

  register(name: string, description: string, handler: (args: string) => Promise<string>): void {
    this.commands.set(name.toLowerCase(), { name, description, handler });
  }

  parse(input: string): ParsedInput {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { isSlash: false };
    }

    const spaceIndex = trimmed.indexOf(' ');
    const command = spaceIndex === -1
      ? trimmed.slice(1).toLowerCase()
      : trimmed.slice(1, spaceIndex).toLowerCase();
    const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

    return { isSlash: true, command, args };
  }

  async execute(name: string, args: string): Promise<string> {
    const cmd = this.commands.get(name.toLowerCase());
    if (!cmd) {
      const available = this.getCommandNames().join(', ');
      return `Unknown command: /${name}\nAvailable: ${available}`;
    }
    return cmd.handler(args);
  }

  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys()).map((n) => `/${n}`);
  }

  getHelp(): string[] {
    const lines: string[] = [];
    for (const cmd of this.commands.values()) {
      lines.push(`  /${cmd.name.padEnd(12)} ${cmd.description}`);
    }
    return lines;
  }

  /** Return names that start with the given prefix (for tab completion) */
  complete(prefix: string): string[] {
    const lower = prefix.toLowerCase();
    return Array.from(this.commands.keys())
      .filter((n) => n.startsWith(lower))
      .map((n) => `/${n}`);
  }
}
