# swarm-cli

Multi-Agent Deliberation CLI - runs coding tasks across multiple AI CLI agents in parallel, then synthesizes conflicts for human decision.

## Overview

`swarm` spawns multiple AI coding agents (Claude, Codex, Gemini) in isolated git worktrees, lets them work on the same task independently, then uses any model to analyze and synthesize the results - identifying conflicts, comparing approaches, and providing recommendations.

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
- At least one AI coding CLI installed:
  - `claude` (Claude Code CLI)
  - `codex` (OpenAI Codex CLI)
  - `gemini` (Google Gemini CLI)
- For API auth (optional): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`

## Usage

```bash
# Basic usage (uses config defaults)
swarm "add input validation to user forms"

# Specify agents with model:variant syntax
swarm "refactor auth" --agents claude:opus,gemini:pro

# Specify synthesizer model
swarm "add tests" --agents claude:sonnet,codex --synthesizer claude:opus

# JSON output
swarm "add unit tests" --json

# Preserve worktrees for inspection
swarm "fix bug in parser" --no-cleanup

# List available models
swarm --list-models

# Initialize config file
swarm --init
```

## Options

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated list of agents (e.g., `claude:opus,gemini:pro`) |
| `-s, --synthesizer <model>` | Model for synthesis (e.g., `claude:sonnet`) |
| `-r, --repo <path>` | Repository path (default: current directory) |
| `-v, --verbose` | Enable verbose output |
| `--json` | Output synthesis as JSON |
| `--no-cleanup` | Don't cleanup worktrees after execution |
| `--list-models` | Show available models and their status |
| `--init` | Create default config file |
| `-h, --help` | Show help message |

## Model Syntax

Models are specified as `provider:variant`:

| Provider | Variants | Example |
|----------|----------|---------|
| `claude` | `opus`, `sonnet`, `haiku` | `claude:opus` |
| `openai` | `o3`, `o4-mini`, `gpt-4.1`, `default` | `openai:o3` |
| `codex` | `default` | `codex` |
| `gemini` | `pro`, `flash`, `default` | `gemini:pro` |

If no variant is specified, the default is used.

## Authentication

Each provider supports two auth modes:

### CLI Auth (Default)
Uses the provider's CLI tool with its built-in auth (subscription-based, no API key needed):
- `claude` → Claude Code CLI
- `codex` → OpenAI Codex CLI
- `gemini` → Google Gemini CLI

### API Auth
Uses the provider's API with an API key:
- `ANTHROPIC_API_KEY` for Claude
- `OPENAI_API_KEY` for OpenAI/Codex
- `GEMINI_API_KEY` for Gemini

The tool auto-detects which auth to use based on available API keys, or you can configure it explicitly in the config file.

## Configuration

Config file: `~/.swarm/config.json`

```json
{
  "defaultAgents": ["claude:sonnet", "codex"],
  "defaultSynthesizer": "claude:sonnet",
  "providers": {
    "claude": {
      "auth": "cli",
      "apiKey": "ANTHROPIC_API_KEY"
    },
    "openai": {
      "auth": "api",
      "apiKey": "OPENAI_API_KEY"
    },
    "gemini": {
      "auth": "cli"
    }
  }
}
```

Run `swarm --init` to create a default config file.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For Claude API auth |
| `OPENAI_API_KEY` | For OpenAI/Codex API auth |
| `GEMINI_API_KEY` | For Gemini API auth |
| `SWARM_AGENTS` | Override default agents |
| `SWARM_SYNTHESIZER` | Override default synthesizer |

## How It Works

1. **Worktree Creation**: Creates isolated git worktrees for each agent
2. **Parallel Execution**: Runs all agents simultaneously on the same task
3. **Synthesis**: Analyzes diffs and outputs to identify conflicts and compare approaches
4. **Recommendations**: Provides actionable recommendations for merging

## Architecture

```
swarm-cli/
├── src/
│   ├── cli.ts           # Entry point and CLI parsing
│   ├── orchestrator.ts  # Parallel execution management
│   ├── synthesizer.ts   # Conflict analysis & synthesis
│   ├── config.ts        # Config file management
│   ├── worktree.ts      # Git worktree management
│   ├── types.ts         # Shared types
│   ├── models/          # Flexible model/auth system
│   │   ├── types.ts     # Model & auth types
│   │   ├── provider.ts  # Abstract provider base
│   │   ├── claude.ts    # Claude provider
│   │   ├── openai.ts    # OpenAI provider
│   │   ├── gemini.ts    # Gemini provider
│   │   └── index.ts     # Module exports
│   └── agents/          # Legacy agent implementations
│       ├── base.ts      # Agent interface
│       ├── claude.ts    # Claude Code agent
│       ├── codex.ts     # Codex agent
│       └── gemini.ts    # Gemini agent
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

# Test the CLI
node dist/cli.js --help
node dist/cli.js --list-models
```

## Adding New Providers

To add a new provider:

1. Create `src/models/newprovider.ts`
2. Implement `ModelProvider` interface
3. Register with `ProviderRegistry`
4. Add to `config.ts` validation

See existing providers for reference.

## License

MIT
