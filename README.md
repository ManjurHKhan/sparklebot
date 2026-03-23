# Sparklebot

[![CI](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml/badge.svg)](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml)

A lightweight, self-hosted Slack bot for peer recognition. Give your teammates sparkles for being awesome.

Inspired by [davidcelis/sparkles](https://github.com/davidcelis/sparkles) and GitHub's internal sparkles system.

## Features

### Dot Commands
- `.sparkle @user [reason]` -- Give someone a sparkle, optionally with a reason
- `.sparkle @user1 @user2 @user3 [reason]` -- Sparkle multiple people at once (duplicates are ignored)
- `.sparkle party` -- Sparkle everyone who posted in the channel in the last 30 minutes
- `.sparkles` -- Get the all-time leaderboard sent to you as a DM
- `.sparkle` or `.sparkle help` -- Show available commands
- `.sparkle bob` -- Sparkle anyone, even non-existent or joke targets (stored as-is)

### Fun Extras
- **Tiered emoji** -- Sparkle count determines the emoji tier: ✨ (1-4) -> :star: (5-9) -> :sparkle: (10-24) -> :dizzy: (25-49) -> :star2: (50-99) -> :gem: (100+)
- **Self-sparkle shame** -- Allowed exactly once per user (it counts!), then blocked with escalating shame messages that track your attempt count
- **Bot sparkle quips** -- Sparkling the bot gets a witty response (not recorded as a real sparkle)
- **First sparkle celebration** -- Special fanfare with emoji, count, and reason when someone receives their very first sparkle
- **Party mode details** -- Party sparkles show each recipient's name, total count, and tier emoji on individual lines
- **Bold formatting** -- Names and counts are bold in all messages for readability
- **Emoji-rich messages** -- Playful and pirate personalities use contextual emoji throughout responses
- **Personality packs** -- Four built-in personalities: playful (default), professional, sarcastic, pirate
- **Display name resolution** -- Uses Slack display names, not raw user IDs

## How It Works

1. Invite Sparklebot to any channel: `/invite @Sparklebot`
2. Someone types `.sparkle @teammate for helping me debug that race condition`
3. Sparklebot instantly posts a confirmation with the recipient's new total and a tiered emoji
4. `.sparkles` sends the leaderboard privately via DM

## Tech Stack

- **Runtime:** Node.js 24
- **Slack SDK:** [@slack/bolt](https://github.com/slackapi/bolt-js) (Socket Mode -- no inbound ports needed)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Testing:** Vitest (75 tests)
- **Deployment:** Docker + Helm chart for Kubernetes

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
- `chat:write` -- Post sparkle confirmations
- `channels:history` -- Read messages for party mode and dot commands
- `channels:read` -- List public channels
- `groups:history` -- Same for private channels
- `groups:read` -- List private channels
- `users:read` -- Resolve user IDs to display names
- `im:write` -- Send DM leaderboards

**Bot Events** (Event Subscriptions > Subscribe to bot events):
- `message.channels` -- Listen for commands in public channels
- `message.groups` -- Listen for commands in private channels

**Install to Workspace** (OAuth & Permissions): Install the app and copy the `SLACK_BOT_TOKEN` (starts with `xoxb-`).

**Signing Secret** (Basic Information > App Credentials): Copy `SLACK_SIGNING_SECRET`.

### 2. Configure Environment

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot user OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | App signing secret |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (`xapp-...`) |

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

## Personalization

All configurable via environment variables:

| Setting | Env Var | Default | Notes |
|---------|---------|---------|-------|
| Currency name | `SPARKLE_CURRENCY` | `sparkle` | Used in response text (e.g. "alice just got 3 kudos!") |
| Currency plural | `SPARKLE_CURRENCY_PLURAL` | `sparkles` | Plural form for display |
| Display emoji | `SPARKLE_EMOJI` | `✨` | Prefix on confirmation messages (overridden by tier system) |
| Personality | `SPARKLE_PERSONALITY` | `playful` | One of: `playful`, `professional`, `sarcastic`, `pirate` |
| Party lookback | `SPARKLE_PARTY_MINUTES` | `30` | How far back party mode looks for recent posters |

Commands are always `.sparkle` and `.sparkles` regardless of currency name.

## Deployment

### Docker

```bash
docker build -t sparklebot .
docker run -d --name sparklebot \
  --env-file .env \
  -v sparklebot-data:/app/data \
  sparklebot
```

No ports need to be exposed -- the bot uses Socket Mode (outbound WebSocket only).

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

## Development

```bash
npm install
npm test          # Run test suite (vitest)
npm run test:watch # Watch mode
npm run dev       # Start with --watch for auto-reload
```

### Project Structure

```
sparklebot/
  src/
    app.js                  -- Entrypoint: Bolt Socket Mode + message routing
    config.js               -- Environment variable loading
    db.js                   -- SQLite schema, queries, and migrations
    messages.js             -- Personality pack loader
    handlers/
      sparkle.js            -- .sparkle command parser, handler, name resolution
      leaderboard.js        -- .sparkles leaderboard handler
    personalities/
      playful.json          -- Default personality (80 messages)
      professional.json
      sarcastic.json
      pirate.json
  tests/                    -- Vitest test files mirroring src/
  helm/sparklebot/          -- Helm chart
  Dockerfile                -- Multi-stage Node 24 alpine build
```

## License

MIT
