# Sparklebot

[![CI](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml/badge.svg)](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml)

A lightweight, self-hosted Slack bot for peer recognition. Give your teammates sparkles for being awesome.

Inspired by [davidcelis/sparkles](https://github.com/davidcelis/sparkles) and GitHub's internal sparkles system.

## Features

### Commands

- **`.sparkle @user [reason]`** — Give someone a sparkle with an optional reason
- **`.sparkle @user1 @user2 [reason]`** — Sparkle multiple people at once (up to 10 per command, duplicates ignored)
- **`.sparkle party`** — Sparkle everyone who posted in the channel in the last 30 minutes (up to 10 recipients, subject to cooldowns)
- **`.sparkles`** — Get the all-time leaderboard sent to you as a DM
- **`.help`** — Show available commands

### Features

- **Tiered emoji** — Sparkle count determines the emoji tier: ✨ (1-4) → ⭐ (5-9) → 💫 (10-24) → 😍 (25-49) → 🌟 (50-99) → 💎 (100+)
- **Self-sparkle shame** — Allowed exactly once per user, then blocked with escalating shame messages
- **Bot sparkle quips** — Sparkling the bot gets a witty response (not recorded as a real sparkle)
- **First sparkle celebration** — Special fanfare with emoji and count when someone receives their very first sparkle
- **Party mode details** — Party sparkles show each recipient's name, total count, and tier emoji on separate lines
- **Bold formatting** — Names and counts are bold in all messages for readability
- **Emoji-rich messages** — Personalities use contextual emoji throughout responses
- **Personality packs** — Four built-in personalities: playful (default), professional, sarcastic, pirate
- **Display name resolution** — Uses Slack display names, not raw user IDs

## Tech Stack

- **Runtime:** Node.js 24
- **Language:** TypeScript (strict mode)
- **Framework:** Dot-command framework with middleware chain
- **Slack SDK:** [@slack/bolt](https://github.com/slackapi/bolt-js) (Socket Mode — no inbound ports needed)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Testing:** Vitest (166 tests including exploit-regression suite)
- **Deployment:** Docker + Helm chart for Kubernetes

## Architecture

The bot is built around a **dot-command framework** that makes it easy to add new commands. Every command inherits a consistent set of security and operational features:

### Command Interface

Each command implements the `Command` interface:
```typescript
interface Command {
  name(): string;              // Command name (e.g. "sparkle")
  aliases(): string[];         // Alternative names (e.g. ["sparkles", "s"])
  help(): string;              // One-liner help text
  access(): AccessLevel;       // Everyone | Restricted
  takesTargets(): boolean;     // Does this command parse @mentions?
  subcommands(): string[];     // Special keywords that bypass target resolution
  run(ctx: Context): Promise<void>;  // The actual command logic
}
```

### Registry & Extension

Adding a new command is a single-liner:
```typescript
registry.register(new MyCommand());
```

The framework handles all common concerns:

- **Target resolution** — `@mention` tokens are validated against Slack's live `users.info` API (no stale data)
- **Human-giver gate** — Only humans can give sparkles; bots and app users are rejected at the middleware layer
- **Output escaping** — All replies go through `SafeText`, a branded-type system that prevents accidental plaintext leaks at the reply boundary
- **Rate limiting** — Sliding-window budget per giver (default: 10 sparkles per 60 seconds), enforced in middleware
- **Input caps** — Targets capped at 10 per command; reasons capped at 256 chars

### Context Surface

Commands receive a `Context` object with everything they need:
```typescript
interface Context {
  command: string;           // Token without the dot
  args: string;              // Remaining text after @mentions
  mentions: User[];          // Resolved live humans (deduped)
  giver: User;               // Human who issued the command
  channel: { id, name };     // Channel metadata
  reply(msg): Promise<void>; // Post to channel
  replyEphemeral(...);       // Ephemeral message
  replyDM(...);              // DM with fallback
  rate.tryConsume(n);        // Rate-limit check
  store: Store;              // DB access
  resolver: ResolverApi;     // User/channel resolution (read-only)
  log(...): void;            // Debug logging
}
```

## How It Works

1. Invite Sparklebot to any channel: `/invite @Sparklebot`
2. Someone types `.sparkle @teammate for helping me debug that race condition`
3. Sparklebot resolves `@teammate` via Slack's `users.info` API (confirming they're a human)
4. Sparklebot increments the count in SQLite and posts a confirmation with the recipient's new total and tier emoji
5. `.sparkles` sends the leaderboard privately via DM

## Quick Start

### From Docker

```bash
docker pull ghcr.io/manjurhkhan/sparklebot:latest
docker run -d --name sparklebot \
  --env-file .env \
  -v sparklebot-data:/app/data \
  ghcr.io/manjurhkhan/sparklebot:latest
```

### From Source

```bash
git clone https://github.com/ManjurHKhan/sparklebot.git
cd sparklebot
npm install
cp .env.example .env
# Fill in your Slack tokens (see Setup below)
npm start
```

### With Helm

```bash
helm install sparklebot oci://ghcr.io/manjurhkhan/charts/sparklebot \
  --set slack.existingSecret=sparklebot-slack
```

## Setup

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app from scratch.

**Socket Mode:** Settings > Socket Mode > Enable. Generate an App-Level Token with `connections:write` scope. This is your `SLACK_APP_TOKEN` (starts with `xapp-`).

**Bot Token Scopes** (OAuth & Permissions > Scopes > Bot Token Scopes):
- `chat:write` — Post sparkle confirmations
- `channels:history` — Read messages for party mode and command parsing
- `channels:read` — List public channels
- `groups:history` — Same for private channels
- `groups:read` — List private channels
- `users:read` — Resolve user IDs to display names
- `im:write` — Send DM leaderboards

**Bot Events** (Event Subscriptions > Subscribe to bot events):
- `message.channels` — Listen for commands in public channels
- `message.groups` — Listen for commands in private channels

**Install to Workspace** (OAuth & Permissions): Install the app and copy the `SLACK_BOT_TOKEN` (starts with `xoxb-`).

**Signing Secret** (Basic Information > App Credentials): Copy `SLACK_SIGNING_SECRET`.

### 2. Configure Environment

```bash
cp .env.example .env
```

Required variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | (required) | Bot user OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | (required) | App signing secret |
| `SLACK_APP_TOKEN` | (required) | App-level token for Socket Mode (`xapp-...`) |

Optional variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SPARKLE_DB_PATH` | `data/sparklebot.db` | Path to SQLite database file |
| `SPARKLE_CURRENCY` | `sparkle` | Currency name (used in response text) |
| `SPARKLE_CURRENCY_PLURAL` | `sparkles` | Plural form for display |
| `SPARKLE_PERSONALITY` | `playful` | One of: `playful`, `professional`, `sarcastic`, `pirate` |
| `SPARKLE_PARTY_MINUTES` | `30` | How far back party mode looks for recent posters |
| `SPARKLE_PARTY_MAX_RECIPIENTS` | `10` | Maximum recipients per party command (clamped to 10) |
| `SPARKLE_PARTY_CHANNEL_COOLDOWN_S` | `300` | Seconds between party commands in the same channel |
| `SPARKLE_PARTY_GIVER_COOLDOWN_S` | `1800` | Seconds between party commands by the same user (30 minutes) |
| `SPARKLE_RATE_LIMIT` | `10` | Max sparkles per user within the time window |
| `SPARKLE_RATE_WINDOW_S` | `60` | Seconds in the rate-limit sliding window |
| `HEALTH_PORT` | `8080` | Port for `/health` readiness probe |

Commands (`.sparkle`, `.sparkles`) are always `.sparkle` and `.sparkles` regardless of currency name.

### 3. Run

```bash
npm install
npm start
```

### 4. Invite to Channels

Sparklebot only listens in channels it's been invited to:

```
/invite @Sparklebot
```

## Deployment

### Docker

```bash
docker build -t sparklebot .
docker run -d --name sparklebot \
  --env-file .env \
  -v sparklebot-data:/app/data \
  sparklebot
```

No ports need to be exposed — the bot uses Socket Mode (outbound WebSocket only).

### Kubernetes (Helm)

The Helm chart is in `helm/sparklebot/`. It expects an existing Kubernetes Secret containing the Slack tokens.

Create the secret:

```bash
kubectl create secret generic sparklebot-slack \
  --from-literal=bot-token=xoxb-your-token \
  --from-literal=signing-secret=your-secret \
  --from-literal=app-token=xapp-your-token
```

Install the chart:

```bash
helm install sparklebot oci://ghcr.io/manjurhkhan/charts/sparklebot
```

Or from local source:

```bash
helm install sparklebot helm/sparklebot/
```

**Important:** Single replica only. SQLite does not support concurrent writers. Do not scale beyond `replicaCount: 1`.

## Security Model

### Deny-by-Default

The bot rejects commands from non-humans (bots, app users) at the middleware layer, before any handler code runs. This prevents self-sparkles from the bot itself or other integrations.

### Resolved Targets Only

All `@mention` tokens are validated against Slack's live `users.info` API before being recorded. Plain text targets (e.g., `.sparkle alice`) are not supported — Slack's mention syntax is required. This prevents:
- Typos from creating fake leaderboard entries
- Stale or deleted user data from being recorded
- Joke or test targets from polluting the database

### Output Escaping

All replies to Slack go through `SafeText`, a branded-type system that enforces string construction via `fmt()`, `trusted()`, or `joinSafe()`. This prevents:
- Accidental plaintext output leaks at the reply boundary
- Injection of unescaped user data into messages
- Type-level mistakes from reaching Slack's API

### Rate Limiting

A sliding-window budget (default: 10 sparkles per 60 seconds) is enforced per giver. On restart, in-memory limits are cleared — this is a tradeoff for simplicity in a single-replica deployment.

## Development

```bash
npm install
npm test              # Run test suite (vitest)
npm run test:watch   # Watch mode
npm run dev          # Start with --watch for auto-reload
npm run typecheck    # TypeScript strict-mode check
npm run build        # Compile to dist/
```

### Contributing / Extending

New command? Read [`docs/extending.md`](docs/extending.md) — it walks through adding one command with a worked `.echo` example, from creation through testing.

### Project Structure

```
sparklebot/
  src/
    index.ts              -- Entrypoint: Bolt Socket Mode + dispatcher setup
    config.ts             -- Environment variable loading
    health.ts             -- /health readiness probe
    messages.ts           -- Personality pack loader
    store/
      store.ts            -- Store interface
      sqlite.ts           -- SQLite schema, queries, migrations
    framework/
      types.ts            -- Command, Context, ResolverApi interfaces
      registry.ts         -- Command registration and lookup
      dispatcher.ts       -- Message routing + middleware chain
      safe.ts             -- SafeText branded type
      rate-limit.ts       -- Sliding-window rate limiter
      resolver.ts         -- Slack user/channel resolution
    commands/
      sparkle.ts          -- .sparkle command with party mode
      sparkles.ts         -- .sparkles leaderboard handler
      help.ts             -- .help command
    personalities/
      playful.json        -- Default personality (80 messages)
      professional.json
      sarcastic.json
      pirate.json
  tests/                  -- Vitest test files (166 tests)
  helm/sparklebot/        -- Helm chart
  Dockerfile              -- Multi-stage Node 24 alpine build
```

## License

MIT
