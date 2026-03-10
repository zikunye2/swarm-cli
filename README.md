# swarm-cli

Multi-Agent Deliberation CLI - runs coding tasks across multiple AI CLI agents in parallel, then synthesizes conflicts for human decision.

## Overview

`swarm` spawns multiple AI coding agents (like Claude Code) in isolated git worktrees, lets them work on the same task independently, then uses Claude to analyze and synthesize the results - identifying conflicts, comparing approaches, and providing recommendations.

## Installation

```bash
npm install -g swarm-cli
# or
npm install
npm run build
npm link
```

## Requirements

- Node.js >= 20
- Git
- Claude Code CLI (`claude` command)
- `ANTHROPIC_API_KEY` environment variable

## Usage

```bash
# Basic usage
swarm "add input validation to user forms"

# With options
swarm "refactor authentication module" --agents claude --verbose

# JSON output
swarm "add unit tests" --json

# Preserve worktrees for inspection
swarm "fix bug in parser" --no-cleanup
```

## Options

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated list of agents (default: claude) |
| `-r, --repo <path>` | Repository path (default: current directory) |
| `-v, --verbose` | Enable verbose output |
| `--json` | Output synthesis as JSON |
| `--no-cleanup` | Don't cleanup worktrees after execution |
| `-h, --help` | Show help message |

## How It Works

1. **Worktree Creation**: Creates isolated git worktrees for each agent
2. **Parallel Execution**: Runs all agents simultaneously on the same task
3. **Synthesis**: Analyzes diffs and outputs to identify conflicts and compare approaches
4. **Recommendations**: Provides actionable recommendations for merging

## Architecture

```
swarm/
├── src/
│   ├── cli.ts           # Entry point
│   ├── orchestrator.ts  # Parallel execution management
│   ├── agents/
│   │   ├── base.ts      # Agent interface
│   │   └── claude.ts    # Claude Code agent
│   ├── worktree.ts      # Git worktree management
│   ├── synthesizer.ts   # Conflict analysis & synthesis
│   └── types.ts         # Shared types
├── package.json
└── tsconfig.json
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode (watch)
npm run dev
```

## Phase 1 (Current)

- [x] Git worktree management
- [x] Claude Code agent
- [x] Parallel orchestration
- [x] Conflict synthesis
- [x] CLI with text/JSON output

## Future Phases

- [ ] Ink-based interactive UI
- [ ] Additional agents (Cursor, Aider, etc.)
- [ ] Merge assistance
- [ ] Web UI dashboard

## License

MIT
