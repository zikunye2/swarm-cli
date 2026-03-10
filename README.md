# 🐝 swarm-cli

Multi-Agent Deliberation CLI — runs coding tasks across multiple AI CLI agents in parallel, then synthesizes conflicts for human decision.

## What It Does

`swarm` spawns multiple AI coding agents (Claude, Codex, Gemini) in isolated git worktrees, lets them work on the same task independently, then uses any model to analyze and synthesize the results — identifying conflicts, comparing approaches, and providing recommendations.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Claude    │   │   Gemini    │   │   Codex     │
│  (worktree) │   │  (worktree) │   │  (worktree) │
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

### AI CLI Agents (at least one required)

| Agent | Installation | Notes |
|-------|--------------|-------|
| **Claude** | `npm install -g @anthropic-ai/claude-code` | Claude Code CLI |
| **Codex** | `npm install -g @openai/codex` | OpenAI Codex CLI |
| **Gemini** | `npm install -g @google/gemini-cli` | Google Gemini CLI |

### API Keys (optional)

For API auth mode (instead of CLI subscriptions):

```bash
export ANTHROPIC_API_KEY="sk-..."   # For Claude API
export OPENAI_API_KEY="sk-..."      # For OpenAI/Codex API
export GEMINI_API_KEY="..."         # For Gemini API
```

## Quick Start

```bash
# Initialize config (optional, creates ~/.swarm/config.json)
swarm --init

# Check available models
swarm --list-models

# Run a task
swarm "add input validation to user forms"
```

## Usage Examples

### Basic Usage

```bash
# Use default agents from config
swarm "add unit tests for the auth module"

# Specify agents explicitly
swarm "refactor database queries" --agents claude:opus,gemini:pro

# Use different synthesizer
swarm "fix memory leak" --agents claude:sonnet,codex --synthesizer claude:opus
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
| `gemini` | `pro`, `flash` | `pro` | `gemini:flash` |

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
      "auth": "cli",
      "apiKey": "ANTHROPIC_API_KEY"
    },
    "openai": {
      "auth": "api"
    },
    "gemini": {
      "auth": "cli"
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
| `providers.<name>.auth` | `"oauth"`, `"cli"`, or `"api"` | Authentication method |
| `providers.<name>.apiKey` | `string` | Environment variable name for API key |
| `providers.<name>.defaultVariant` | `string` | Default variant for this provider |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For Claude API auth |
| `OPENAI_API_KEY` | For OpenAI/Codex API auth |
| `GEMINI_API_KEY` | For Gemini API auth |
| `SWARM_AGENTS` | Override default agents |
| `SWARM_SYNTHESIZER` | Override default synthesizer |

### Auth Modes

**OAuth Auth (Recommended for Subscription Users)**
- Automatically reads OAuth tokens from CLI credential stores
- Claude: reads from macOS Keychain (`Claude Code-credentials`) or `~/.claude/.credentials.json`
- Codex: reads from macOS Keychain (`Codex Auth`) or `~/.codex/auth.json`
- Uses SDK directly with OAuth token — avoids CLI hanging issues on M1 Macs
- Best for synthesis operations (no CLI spawn required)

**CLI Auth (Default)**
- Uses the provider's installed CLI tool
- Requires subscription to the CLI service
- No API key needed
- ⚠️ May hang on macOS M1 in some cases

**API Auth**
- Uses the provider's API directly
- Requires API key in environment
- May have different rate limits/costs

**Auth Priority:**
1. OAuth token from CLI credentials (subscription users)
2. API key from environment variable (API users)
3. CLI fallback (spawns CLI tool)

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
2. **Parallel Execution**: Runs all agents simultaneously on the same task
3. **Result Collection**: Gathers diffs and output from each agent
4. **Synthesis**: Analyzes all results to identify conflicts and compare approaches
5. **Human Decision**: Presents conflicts for human resolution
6. **Apply Changes**: Optionally applies chosen agent's changes to main branch
7. **Logging**: Records session details to SWARM_LOG.md
8. **Cleanup**: Removes worktrees (unless `--no-cleanup`)

## Project Structure

```
swarm-cli/
├── src/
│   ├── cli.ts           # Entry point and CLI parsing
│   ├── orchestrator.ts  # Parallel execution management
│   ├── synthesizer.ts   # Conflict analysis & synthesis
│   ├── config.ts        # Config file management
│   ├── worktree.ts      # Git worktree management
│   ├── logging.ts       # Session logging (SWARM_LOG.md)
│   ├── applier.ts       # Apply changes to main branch
│   ├── types.ts         # Shared types
│   ├── auth/            # OAuth credential reading
│   │   ├── credentials.ts # Keychain/file credential readers
│   │   └── index.ts     # Module exports
│   ├── models/          # Flexible model/auth system
│   │   ├── types.ts     # Model & auth types
│   │   ├── provider.ts  # Abstract provider base
│   │   ├── claude.ts    # Claude provider
│   │   ├── openai.ts    # OpenAI provider
│   │   ├── gemini.ts    # Gemini provider
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
3. Register with `ProviderRegistry`
4. Add to `src/config.ts` validation

See existing providers for reference implementation.

## Troubleshooting

### "No agents available"
- Install at least one AI CLI tool (claude, codex, or gemini)
- Or set API keys for API auth mode
- Run `swarm --list-models` to check availability

### "Worktree creation failed"
- Ensure you're in a git repository
- Check that you have write permissions
- Ensure no uncommitted changes on conflicting branches

### "Synthesis failed"
- Check that synthesizer model is available
- Try a different synthesizer: `--synthesizer claude:sonnet`
- Synthesis failures will show raw diffs as fallback

### CLI hanging on macOS M1
- swarm-cli now automatically uses OAuth tokens when available
- Ensure you've logged into the CLI at least once (`claude login`, `codex auth login`)
- OAuth tokens are read from keychain/credential files automatically
- Set API keys as fallback: `export ANTHROPIC_API_KEY="sk-..."`

### Ctrl+C not cleaning up
- Press Ctrl+C once for graceful shutdown
- Press twice to force exit
- Run `git worktree prune` to cleanup orphaned worktrees

## License

MIT
