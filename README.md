# 🐝 swarm-cli

Multi-Agent Deliberation CLI — runs coding tasks across multiple AI agents in parallel using their SDKs with tool calling, then synthesizes conflicts for human decision.

## What It Does

`swarm` runs multiple AI coding agents (Claude, OpenAI, Gemini) in isolated git worktrees using their native SDKs with tool calling. Each agent works on the same task independently, then a synthesizer analyzes the results — identifying conflicts, comparing approaches, and providing recommendations.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Claude    │   │   Gemini    │   │   OpenAI    │
│  (SDK+Tools)│   │  (SDK+Tools)│   │  (SDK+Tools)│
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │
       └────────────┬────┴────────────────┘
                    │
           ┌────────▼────────┐
           │   Synthesizer   │
           │  (analyzes all) │
           └────────┬────────┘
                    │
           ┌────────▼────────┐
           │  Human Decision │
           │  (resolve diff) │
           └─────────────────┘
```

## Installation

```bash
# Clone and install
git clone https://github.com/yourrepo/swarm-cli
cd swarm-cli
npm install
npm run build
npm link

# Or install globally (when published)
npm install -g swarm-cli
```

## Requirements

### Node.js
- **Node.js >= 20** required

### Git
- Git must be installed and available in PATH
- Must be run inside a git repository

### API Keys (at least one required)

swarm-cli uses native SDKs with tool calling. Set at least one API key:

```bash
export ANTHROPIC_API_KEY="sk-..."   # For Claude
export OPENAI_API_KEY="sk-..."      # For OpenAI
export GEMINI_API_KEY="..."         # For Gemini
```

**Or use subscription credentials:**
- Claude: automatically reads OAuth tokens from `~/.claude/.credentials.json` or macOS Keychain
- Codex: automatically reads OAuth tokens from `~/.codex/auth.json` or macOS Keychain
- Gemini: automatically reads OAuth tokens from `~/.config/gemini/credentials.json`

## Quick Start

```bash
# Initialize config (optional, creates ~/.swarm/config.json)
swarm --init

# Check available models
swarm --list-models

# Run a task
swarm "add input validation to user forms"
```

## Agent Capabilities

Each agent has access to these tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `list_directory` | List files and directories |
| `execute_command` | Run shell commands |
| `search_files` | Find files by glob pattern |
| `grep` | Search for patterns in files |
| `task_complete` | Signal task completion |

Agents can explore the codebase, make changes, run tests, and verify their work — all through native SDK tool calling.

## Usage Examples

### Basic Usage

```bash
# Use default agents from config
swarm "add unit tests for the auth module"

# Specify agents explicitly
swarm "refactor database queries" --agents claude:opus,gemini:pro

# Use different synthesizer
swarm "fix memory leak" --agents claude:sonnet,openai --synthesizer claude:opus
```

### Output Options

```bash
# JSON output (for scripting/CI)
swarm "add error handling" --json

# Verbose mode (debug info)
swarm "update dependencies" --verbose

# Batch mode (no interactive UI)
swarm "lint fixes" --no-ui
```

### Worktree Management

```bash
# Keep worktrees after execution (for manual inspection)
swarm "complex refactor" --no-cleanup

# Apply chosen changes to main branch
swarm "add feature" --apply
```

### Example Output

```
🐝 SWARM starting...
Task: "add input validation to user forms"
Agents: claude:sonnet, gemini:pro
Synthesizer: claude:sonnet

🚀 Running agents in parallel...

✅ claude:sonnet  │  🔄 gemini:pro 45s

Agent Status:
  ✅ claude:sonnet: completed 32.1s
  ✅ gemini:pro: completed 48.3s

🔬 Synthesizing results...

═══════════════════════════════════════════════════════════
  SWARM SYNTHESIS REPORT
═══════════════════════════════════════════════════════════

AGENT SUMMARIES

✅ CLAUDE:SONNET
   Approach: Added Zod schema validation with custom error messages
   Files: src/forms/validation.ts, src/forms/UserForm.tsx
   Strengths:
     ✓ Type-safe validation
     ✓ Reusable validation schemas

✅ GEMINI:PRO  
   Approach: Inline validation with regex patterns
   Files: src/forms/UserForm.tsx, src/utils/validators.ts
   Strengths:
     ✓ Simpler implementation
     ✓ No additional dependencies

CONFLICTS

🟡 src/forms/UserForm.tsx [MEDIUM]
   Type: Different Changes
   Both agents modified the form component with different approaches

RECOMMENDATIONS

📋 src/forms/UserForm.tsx
   Recommendation: Use Claude's Zod-based approach
   Preferred: claude:sonnet
   Reason: Better type safety and error handling

✨ Done!
```

## CLI Options

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated list of agents (e.g., `claude:opus,gemini:pro`) |
| `-s, --synthesizer <model>` | Model for synthesis (e.g., `claude:sonnet`) |
| `-r, --repo <path>` | Repository path (default: current directory) |
| `-v, --verbose` | Enable verbose output |
| `-i, --ui` | Enable interactive UI (default) |
| `--no-ui, --batch` | Disable interactive UI |
| `--apply` | Apply chosen agent's changes to main branch |
| `--no-log` | Don't write to SWARM_LOG.md |
| `--json` | Output synthesis as JSON |
| `--no-cleanup` | Don't cleanup worktrees after execution |
| `--list-models` | Show available models and their status |
| `--init` | Create default config file |
| `--version` | Show version number |
| `-h, --help` | Show help message |

## Model Syntax

Models are specified as `provider:variant`:

| Provider | Variants | Default | Example |
|----------|----------|---------|---------|
| `claude` | `opus`, `sonnet`, `haiku` | `sonnet` | `claude:opus` |
| `openai` | `o3`, `o4-mini`, `gpt-4.1` | `default` | `openai:o3` |
| `codex` | `default` | `default` | `codex` |
| `gemini` | `pro`, `flash` | `default` | `gemini:flash` |

If no variant is specified, the default is used (e.g., `claude` = `claude:sonnet`).

## Configuration

### Config File

Location: `~/.swarm/config.json`

```json
{
  "defaultAgents": ["claude:sonnet", "gemini:pro"],
  "defaultSynthesizer": "claude:opus",
  "providers": {
    "claude": {
      "auth": "api",
      "apiKey": "ANTHROPIC_API_KEY"
    },
    "openai": {
      "auth": "api",
      "apiKey": "OPENAI_API_KEY"
    },
    "gemini": {
      "auth": "api",
      "apiKey": "GEMINI_API_KEY"
    }
  }
}
```

Run `swarm --init` to create a default config file.

### Config Options

| Option | Type | Description |
|--------|------|-------------|
| `defaultAgents` | `string[]` | Default agents to use when none specified |
| `defaultSynthesizer` | `string` | Default model for synthesis |
| `providers.<name>.auth` | `"oauth"` or `"api"` | Authentication method |
| `providers.<name>.apiKey` | `string` | Environment variable name for API key |
| `providers.<name>.defaultVariant` | `string` | Default variant for this provider |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For Claude |
| `OPENAI_API_KEY` | For OpenAI |
| `GEMINI_API_KEY` | For Gemini |
| `SWARM_AGENTS` | Override default agents |
| `SWARM_SYNTHESIZER` | Override default synthesizer |

### Auth Modes

**OAuth Auth (Recommended for Subscription Users)**
- Automatically reads OAuth tokens from CLI credential stores
- Claude: reads from macOS Keychain (`Claude Code-credentials`) or `~/.claude/.credentials.json`
- Codex: reads from macOS Keychain (`Codex Auth`) or `~/.codex/auth.json`
- Uses SDK directly with OAuth token
- No CLI spawning required

**API Auth (Default)**
- Uses the provider's API directly with SDK
- Requires API key in environment
- Full control via SDK tool calling

## Decision Logging

Each swarm session is logged to `SWARM_LOG.md` in the repository:

```markdown
## Monday, March 10, 2025 at 10:30 AM

**Task:** add input validation to user forms

### Configuration
- **Agents:** claude:sonnet, gemini:pro
- **Synthesizer:** claude:opus
- **Duration:** 52.3s

### Agent Results
| Agent | Status | Files Changed |
|-------|--------|---------------|
| claude:sonnet | ✅ Success | 3 |
| gemini:pro | ✅ Success | 2 |

### Conflicts
| File | Severity | Type |
|------|----------|------|
| `src/forms/UserForm.tsx` | 🟡 Medium | Different Changes |

### Decisions
- **`src/forms/UserForm.tsx`**: Used claude:sonnet's changes
```

Use `--no-log` to disable logging.

## How It Works

1. **Worktree Creation**: Creates isolated git worktrees for each agent
2. **Parallel Execution**: Runs all agents simultaneously using SDK tool calling
3. **Agent Loop**: Each agent iteratively reads files, makes changes, and verifies work
4. **Result Collection**: Gathers diffs and output from each agent
5. **Synthesis**: Analyzes all results to identify conflicts and compare approaches
6. **Human Decision**: Presents conflicts for human resolution
7. **Apply Changes**: Optionally applies chosen agent's changes to main branch
8. **Logging**: Records session details to SWARM_LOG.md
9. **Cleanup**: Removes worktrees (unless `--no-cleanup`)

## Architecture

```
swarm-cli/
├── src/
│   ├── cli.ts           # Entry point and CLI parsing
│   ├── orchestrator.ts  # Parallel execution management
│   ├── synthesizer.ts   # Conflict analysis & synthesis
│   ├── agent-loop.ts    # SDK-based agent loop with tool calling
│   ├── config.ts        # Config file management
│   ├── worktree.ts      # Git worktree management
│   ├── logging.ts       # Session logging (SWARM_LOG.md)
│   ├── applier.ts       # Apply changes to main branch
│   ├── types.ts         # Shared types
│   ├── auth/            # OAuth credential reading
│   │   ├── credentials.ts # Keychain/file credential readers
│   │   └── index.ts     # Module exports
│   ├── tools/           # Tool definitions and executor
│   │   ├── definitions.ts # Tool schemas for all providers
│   │   ├── executor.ts  # Execute tool calls (file ops, shell)
│   │   └── index.ts     # Module exports
│   ├── models/          # SDK-based provider system
│   │   ├── types.ts     # Model & auth types
│   │   ├── provider.ts  # Abstract provider base
│   │   ├── claude.ts    # Claude SDK provider
│   │   ├── openai.ts    # OpenAI SDK provider
│   │   ├── gemini.ts    # Gemini SDK provider
│   │   └── index.ts     # Module exports
│   └── ui/              # Interactive Ink UI
│       ├── App.tsx      # Main UI component
│       ├── AgentProgress.tsx
│       ├── SynthesisView.tsx
│       └── DecisionPanel.tsx
├── tests/               # Test files
│   ├── config.test.ts
│   ├── worktree.test.ts
│   └── logging.test.ts
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

# Run tests
npm test

# Test the CLI locally
node dist/cli.js --help
node dist/cli.js --list-models
```

## Adding New Providers

To add a new AI provider:

1. Create `src/models/newprovider.ts`
2. Implement `ModelProvider` interface
3. Add tool calling support via `runAgentLoop`
4. Register with `ProviderRegistry`
5. Add to `src/config.ts` validation

See existing providers for reference implementation.

## Troubleshooting

### "No agents available"
- Set at least one API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)
- Or ensure you have OAuth credentials from logging into the respective CLI
- Run `swarm --list-models` to check availability

### "Worktree creation failed"
- Ensure you're in a git repository
- Check that you have write permissions
- Ensure no uncommitted changes on conflicting branches

### "Synthesis failed"
- Check that synthesizer model is available
- Try a different synthesizer: `--synthesizer claude:sonnet`
- Synthesis failures will show raw diffs as fallback

### Ctrl+C not cleaning up
- Press Ctrl+C once for graceful shutdown
- Press twice to force exit
- Run `git worktree prune` to cleanup orphaned worktrees

## Why SDK Instead of CLI?

Previous versions spawned CLI tools (claude, codex, gemini) to run agent tasks. This approach had issues:
- CLI hanging on macOS M1/M2
- Limited control over agent execution
- Complex output parsing
- Process management overhead

The current SDK-based approach:
- Uses native tool calling for each provider
- Full control over the agent loop
- Consistent behavior across platforms
- Better error handling and observability

## License

MIT
