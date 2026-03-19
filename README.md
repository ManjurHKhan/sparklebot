# Sparklebot

A lightweight Slack bot for peer recognition. Give your teammates sparkles for being awesome.

Inspired by the original [Hubot sparkles script](https://github.com/pmn/sparkles) that was popular at GitHub, and [davidcelis/sparkles](https://github.com/davidcelis/sparkles).

## Features

### Give Sparkles
- `.sparkle @user [reason]` — Give someone a sparkle, optionally with a reason
- `.sparkle @user1 @user2 @user3 [reason]` — Sparkle multiple people at once
- React to any message with `:sparkle:` emoji — Gives the message author a sparkle

### Sparkle Party
- `.sparkle party [minutes]` — Give a sparkle to everyone who posted in the channel in the last N minutes (default: 15)

### Leaderboard & History
- `.sparkles` — Get the 30-day rolling leaderboard sent to you as a DM
- `.sparkles @user` — View someone's sparkle history via DM
- `.sparkles me` — View your own sparkle history via DM

### Fun Extras
- **Self-sparkle shame** — You can sparkle yourself, but you'll be called out publicly. Nothing wrong with a little pat on the back, right?
- **Bot protection** — Bots politely decline sparkles
- **First sparkle celebration** — Extra fanfare when someone gets their very first sparkle
- **Random encouragement** — Fun, randomized confirmation messages ("Boo-yah!", "Shut the front door!", etc.)

## How It Works

1. Invite Sparklebot to any channel
2. Someone types `.sparkle @teammate for helping me debug that nasty race condition`
3. Sparklebot replies in-channel confirming the sparkle and showing the recipient's new total
4. The team reacts to the original `.sparkle` message — that's the recognition moment
5. Want to see who's on top? `.sparkles` sends you the leaderboard privately

## Tech Stack

- **Runtime:** Node.js
- **Slack SDK:** [@slack/bolt](https://github.com/slackapi/bolt-js)
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Deployment:** Single container, Kubernetes-ready

## Setup

### 1. Create a Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app. Required bot token scopes:

- `chat:write` — Post sparkle confirmations
- `channels:history` — Read messages for party mode and dot commands
- `groups:history` — Same for private channels
- `reactions:read` — Detect `:sparkle:` emoji reactions
- `users:read` — Validate sparkle recipients
- `im:write` — Send DM leaderboards and history

Subscribe to these bot events:
- `message.channels` — Listen for `.sparkle` / `.sparkles` commands
- `message.groups` — Same for private channels
- `reaction_added` — Listen for `:sparkle:` emoji reactions

### 2. Configure Environment

```bash
cp .env.example .env
```

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # if using socket mode
PORT=3000
```

### 3. Run

```bash
npm install
npm start
```

### 4. Invite to Channels

Sparklebot only listens in channels it's been invited to. In any channel:

```
/invite @Sparklebot
```

## Deployment

Includes Kubernetes manifests in `k8s/`. See deployment docs for details.

## License

MIT
