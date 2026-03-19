# Sparklebot

[![CI](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml/badge.svg)](https://github.com/ManjurHKhan/sparklebot/actions/workflows/ci.yml)

A lightweight, self-hosted Slack bot for peer recognition. Give your teammates sparkles for being awesome.

Inspired by [davidcelis/sparkles](https://github.com/davidcelis/sparkles) and GitHub's internal sparkles system.

## Features

### Dot Commands
- `.sparkle @user [reason]` -- Give someone a sparkle
- `.sparkle @user1 @user2 @user3 [reason]` -- Sparkle multiple people at once
- `.sparkle party` -- Sparkle everyone who posted in the channel recently
- `.sparkles` -- Get the all-time leaderboard sent to you as a DM

### Web Dashboard
Dark-themed dashboard with Slack OAuth login:
- Leaderboard with podium for top 3
- Live activity feed (HTMX polling)
- Channel stats with bar charts
- Personal sparkle history (received/given)

### Fun Extras
- **Self-sparkle shame** -- Allowed exactly once, then escalating shame messages
- **Bot sparkles** -- Accepted with quirky acknowledgments
- **First sparkle celebration** -- Special fanfare for first-ever sparkles
- **Personality packs** -- Playful (default), professional, sarcastic, pirate
- **Aggregation batching** -- Multiple sparkles for the same person get combined into one message

## How It Works

1. Invite Sparklebot to any channel
2. `.sparkle @teammate for helping me debug that race condition`
3. Sparklebot batches nearby sparkles and posts a single confirmation
4. `.sparkles` sends you the leaderboard privately
5. Visit the dashboard for stats, history, and channel breakdowns

## Tech Stack

- **Runtime:** Node.js 22
- **Slack SDK:** [@slack/bolt](https://github.com/slackapi/bolt-js) (Socket Mode)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Dashboard:** Express 5 + EJS + HTMX 2.0.4
- **Deployment:** Helm chart, single container on Kubernetes

## Setup

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app.

**Socket Mode:** Enable and generate an App-Level Token with `connections:write` scope.

**Bot Token Scopes:** `chat:write`, `channels:history`, `groups:history`, `users:read`, `im:write`

**Bot Events:** `message.channels`, `message.groups`

**OAuth (for dashboard):** Note the Client ID and Client Secret. Add your redirect URL (`https://yourhost/auth/callback`).

### 2. Configure

```bash
cp .env.example .env
# Fill in your Slack tokens
```

### 3. Run

```bash
npm install
npm start
```

Dashboard at `http://localhost:3000`. Bot connects via Socket Mode (no ingress needed for Slack traffic).

### 4. Invite to Channels

```
/invite @Sparklebot
```

## Personalization

All configurable via environment variables (see `.env.example`):

| Setting | Env Var | Default |
|---------|---------|---------|
| Currency name | `SPARKLE_CURRENCY` | sparkle |
| Display emoji | `SPARKLE_EMOJI` | sparkles emoji |
| Personality | `SPARKLE_PERSONALITY` | playful |
| Brand colors | `SPARKLE_COLOR_PRIMARY` / `SPARKLE_COLOR_ACCENT` | #6C5CE7 / #FFEAA7 |
| Party lookback | `SPARKLE_PARTY_MINUTES` | 30 |

Commands are always `.sparkle` and `.sparkles` regardless of currency name.

## Deployment

Helm chart in `helm/sparklebot/`. Requires an existing Kubernetes Secret with Slack tokens.

```bash
helm install sparklebot helm/sparklebot/ \
  --set ingress.host=sparklebot.example.com \
  --set slack.existingSecret=sparklebot-slack
```

Single replica only (SQLite). Uses a PVC for data persistence (default: 5Gi ceph-block).

## License

MIT
