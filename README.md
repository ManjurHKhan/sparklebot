# Sparklebot

[![CI](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml/badge.svg)](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml)

A lightweight, self-hosted Slack bot for peer recognition. Give your teammates sparkles for being awesome.

Inspired by [davidcelis/sparkles](https://github.com/davidcelis/sparkles) and GitHub's internal sparkles system.

## Features

### Dot Commands
- `.sparkle @user [reason]` -- Give someone a sparkle, optionally with a reason
- `.sparkle @user1 @user2 @user3 [reason]` -- Sparkle multiple people at once
- `.sparkle party` -- Sparkle everyone who posted in the channel in the last 30 minutes
- `.sparkles` -- Get the all-time leaderboard sent to you as a DM
- `.sparkle bob` -- Sparkle anyone, even non-existent or joke targets (stored as-is)

### Web Dashboard
Dark-themed dashboard (Linear/Raycast inspired) with Slack OAuth login:
- **Leaderboard** -- Podium for top 3, ranked list for 4-10
- **Activity feed** -- Live stream of recent sparkles with HTMX polling
- **Channel stats** -- Bar charts ranking channels by sparkle activity
- **My Sparkles** -- Personal stats (received, given, rank) with tabbed history

### Fun Extras
- **Self-sparkle shame** -- Allowed exactly once per user (it counts!), then blocked with escalating shame messages that track your attempt count
- **Bot sparkles** -- Sparkling a bot is accepted and counts, with quirky acknowledgments
- **First sparkle celebration** -- Special fanfare when someone receives their very first sparkle
- **Personality packs** -- Four built-in personalities: playful (default), professional, sarcastic, pirate
- **Aggregation batching** -- Multiple sparkles for the same person within a short window get combined into one confirmation message (15s initial, extends up to 2min)

## How It Works

1. Invite Sparklebot to any channel: `/invite @Sparklebot`
2. Someone types `.sparkle @teammate for helping me debug that race condition`
3. Sparklebot batches nearby sparkles and posts a single confirmation with the recipient's new total
4. `.sparkles` sends the leaderboard privately via DM
5. Visit the web dashboard for stats, history, and channel breakdowns

## Tech Stack

- **Runtime:** Node.js 22
- **Slack SDK:** [@slack/bolt](https://github.com/slackapi/bolt-js) (Socket Mode -- no inbound webhooks needed)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Dashboard:** Express 5 + EJS + [HTMX](https://htmx.org/) 2.0.4 (bundled, no CDN)
- **Testing:** Vitest
- **Deployment:** Docker + Helm chart for Kubernetes

## Quick Start

### From Docker

```bash
docker pull ghcr.io/manjurhkhan/sparklebot:latest
docker run -d --name sparklebot \
  --env-file .env \
  -p 3000:3000 \
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

Dashboard at `http://localhost:3000`. Bot connects via Socket Mode.

### With Helm

```bash
helm install sparklebot oci://ghcr.io/manjurhkhan/charts/sparklebot \
  --set ingress.host=sparklebot.example.com \
  --set slack.existingSecret=sparklebot-slack \
  --set sparkle.oauthRedirectUri=https://sparklebot.example.com/auth/callback
```

## Setup

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app from scratch.

**Socket Mode:** Settings > Socket Mode > Enable. Generate an App-Level Token with `connections:write` scope. This is your `SLACK_APP_TOKEN` (starts with `xapp-`).

**Bot Token Scopes** (OAuth & Permissions > Scopes > Bot Token Scopes):
- `chat:write` -- Post sparkle confirmations
- `channels:history` -- Read messages for party mode and dot commands
- `groups:history` -- Same for private channels
- `users:read` -- Resolve user IDs to display names
- `im:write` -- Send DM leaderboards

**Bot Events** (Event Subscriptions > Subscribe to bot events):
- `message.channels` -- Listen for commands in public channels
- `message.groups` -- Listen for commands in private channels

**Install to Workspace** (OAuth & Permissions): Install the app and copy the `SLACK_BOT_TOKEN` (starts with `xoxb-`).

**Signing Secret** (Basic Information > App Credentials): Copy `SLACK_SIGNING_SECRET`.

**OAuth for Dashboard** (OAuth & Permissions):
- Note the **Client ID** and **Client Secret** from Basic Information
- Add a redirect URL: `http://localhost:3000/auth/callback` (or your production URL)

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
| `SLACK_CLIENT_ID` | OAuth client ID (for dashboard login) |
| `SLACK_CLIENT_SECRET` | OAuth client secret (for dashboard login) |
| `SPARKLE_SESSION_SECRET` | Random string for cookie signing (generate with `openssl rand -hex 32`) |
| `SPARKLE_OAUTH_REDIRECT_URI` | OAuth callback URL, must match Slack app config (e.g. `http://localhost:3000/auth/callback`) |

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
| Display emoji | `SPARKLE_EMOJI` | `✨` | Prefix on confirmation messages |
| Personality | `SPARKLE_PERSONALITY` | `playful` | One of: `playful`, `professional`, `sarcastic`, `pirate` |
| Brand primary color | `SPARKLE_COLOR_PRIMARY` | `#6C5CE7` | Dashboard accent color (hex only) |
| Brand accent color | `SPARKLE_COLOR_ACCENT` | `#FFEAA7` | Dashboard gradient accent (hex only) |
| Company logo | `SPARKLE_LOGO_URL` | _(none)_ | URL to logo image for dashboard |
| Party lookback | `SPARKLE_PARTY_MINUTES` | `30` | How far back party mode looks for recent posters |
| Batch initial wait | `SPARKLE_BATCH_INITIAL_SECONDS` | `15` | Seconds to wait before posting confirmation |
| Batch extend | `SPARKLE_BATCH_EXTEND_SECONDS` | `15` | Seconds to extend window per additional sparkle |
| Batch max wait | `SPARKLE_BATCH_MAX_SECONDS` | `120` | Maximum batch window before forcing confirmation |

Commands are always `.sparkle` and `.sparkles` regardless of currency name.

## Deployment

### Docker

```bash
docker build -t sparklebot .
docker run -d --name sparklebot \
  --env-file .env \
  -p 3000:3000 \
  -v sparklebot-data:/app/data \
  sparklebot
```

### Kubernetes (Helm)

The Helm chart is in `helm/sparklebot/`. It expects an existing Kubernetes Secret containing the Slack tokens and session secret.

Create the secret:

```bash
kubectl create secret generic sparklebot-slack \
  --from-literal=bot-token=xoxb-your-token \
  --from-literal=signing-secret=your-secret \
  --from-literal=app-token=xapp-your-token \
  --from-literal=oauth-client-id=your-client-id \
  --from-literal=oauth-client-secret=your-client-secret \
  --from-literal=session-secret=$(openssl rand -hex 32)
```

Install the chart:

```bash
helm install sparklebot oci://ghcr.io/manjurhkhan/charts/sparklebot \
  --set ingress.host=sparklebot.example.com \
  --set sparkle.oauthRedirectUri=https://sparklebot.example.com/auth/callback
```

Or from local source:

```bash
helm install sparklebot helm/sparklebot/ \
  --set ingress.host=sparklebot.example.com \
  --set sparkle.oauthRedirectUri=https://sparklebot.example.com/auth/callback
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
    app.js                  -- Entrypoint: wires Bolt + Express
    config.js               -- Environment variable loading
    db.js                   -- SQLite schema and queries
    batcher.js              -- Sparkle aggregation window
    formatter.js            -- Batch confirmation message formatting
    messages.js             -- Personality pack loader
    handlers/
      sparkle.js            -- .sparkle command parser and handler
      leaderboard.js        -- .sparkles leaderboard handler
    personalities/
      playful.json          -- Default personality
      professional.json
      sarcastic.json
      pirate.json
    web/
      auth.js               -- Slack OAuth flow
      routes.js             -- Dashboard Express routes
      public/
        style.css           -- Dark premium theme
        htmx.min.js         -- Bundled HTMX 2.0.4
      views/
        leaderboard.ejs     -- Podium + ranked list
        feed.ejs            -- Live activity stream
        channels.ejs        -- Channel bar charts
        history.ejs         -- Personal stats + tabs
        login.ejs           -- Slack OAuth login page
        error.ejs           -- Error page
        partials/
          header.ejs        -- Shared layout header + sidebar
          footer.ejs        -- Shared layout footer
          sparkle-card.ejs  -- Reusable sparkle entry card
          sparkle-list.ejs  -- List of sparkle cards
  tests/                    -- Vitest test files mirroring src/
  helm/sparklebot/          -- Helm chart
  Dockerfile                -- Multi-stage alpine build
```

## License

MIT
