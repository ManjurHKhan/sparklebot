# Sparklebot Design Spec

A lightweight, self-hosted Slack bot for peer recognition. Users give each other "sparkles" (or a custom currency name) via dot commands. Includes a web dashboard for viewing history and stats.

## Architecture

Single Node.js container running:
- **Slack bot** via Bolt SDK in Socket Mode (WebSocket, no ingress needed for bot traffic)
- **Express HTTP server** for the web dashboard (HTMX + EJS, Slack OAuth)
- **SQLite** via better-sqlite3 on a persistent volume

Deployed via Helm chart to Kubernetes.

```
+--------------------------------------+
|          sparklebot container         |
|                                       |
|  Bolt SDK <--WebSocket--> Slack       |
|       |                               |
|       v                               |
|   SQLite DB <--> Express HTTP         |
|   (PVC)          (HTMX + EJS)        |
|       |               |              |
|   Personality      Slack OAuth       |
|   Pack (JSON)      + Branding        |
+--------------------------------------+
  Deployed via Helm
```

## File Structure

```
sparklebot/
  src/
    app.js                    -- Bolt + Express setup, socket mode
    db.js                     -- SQLite schema, query functions
    config.js                 -- Env vars, personality, branding
    batcher.js                -- Aggregation window logic
    messages.js               -- Load personality pack, message selection
    handlers/
      sparkle.js              -- .sparkle (single, multi, party)
      leaderboard.js          -- .sparkles leaderboard via DM
    personalities/
      playful.json            -- Default: high energy, fun
      professional.json       -- Corporate-friendly
      sarcastic.json          -- Dry humor
      pirate.json             -- Themed fun
    web/
      routes.js               -- Express routes for dashboard
      auth.js                 -- Slack OAuth flow
      views/
        layout.ejs            -- Base layout (branding colors, logo)
        leaderboard.ejs       -- All-time rankings
        history.ejs           -- Personal given/received
        feed.ejs              -- Recent activity feed
        channels.ejs          -- Channel stats
  helm/
    sparklebot/
      Chart.yaml
      values.yaml
      templates/
        deployment.yaml
        service.yaml
        pvc.yaml
        ingress.yaml
        secret.yaml
        configmap.yaml
  Dockerfile
  package.json
  README.md
  .env.example
```

## Database Schema

```sql
CREATE TABLE sparkles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giver_id TEXT NOT NULL,          -- Slack user ID
  receiver_id TEXT NOT NULL,       -- Slack user ID or raw text if unresolved
  receiver_name TEXT,              -- Display name (raw input if unresolved)
  reason TEXT,                     -- Optional
  channel_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE self_sparkle_attempts (
  user_id TEXT PRIMARY KEY,
  succeeded INTEGER DEFAULT 0,     -- 0 or 1 (first attempt succeeds)
  attempts INTEGER DEFAULT 0,      -- Total attempts including first
  last_attempt DATETIME
);

CREATE INDEX idx_sparkles_receiver ON sparkles(receiver_id);
CREATE INDEX idx_sparkles_channel ON sparkles(channel_id);
CREATE INDEX idx_sparkles_created ON sparkles(created_at);
CREATE INDEX idx_sparkles_giver ON sparkles(giver_id);
```

## Features

### Dot Commands

#### `.sparkle @user [reason]`

Give a sparkle to one or more users. Reasons are optional. Input is normalized: `@mkhan`, `mkhan`, and Slack's `<@U123ABC>` mention markup all resolve to the same identifier. Non-existent users are accepted without validation and stored as raw text.

**Multi-sparkle:** `.sparkle @user1 @user2 @user3 [reason]` gives each user a sparkle with the same reason. One combined confirmation message.

**Confirmation** is batched via the aggregation window (see below) and posted in-channel. The receiver is `@` mentioned. Givers are shown by display name only (no `@` mentions, no extra notifications).

#### `.sparkle party`

Sparkle everyone who posted in the channel within the last N minutes (default: 30). The triggerer is excluded. No minutes argument -- the lookback window is a hardcoded config value.

Party sparkles go through the same aggregation window as regular sparkles.

#### `.sparkles`

Sends the all-time top 10 leaderboard via DM to the requester. Format:

```
All-Time Sparkle Leaderboard

1. @alice - 42 sparkles
2. @bob - 38 sparkles
3. @carol - 31 sparkles
4. dave - 25 sparkles
5. eve - 22 sparkles
...
10. jack - 8 sparkles

You're ranked #14 with 5 sparkles.
```

Medals (emoji) for top 3. If the requester is not in the top 10, their rank and count are shown at the bottom.

### Special Behaviors

#### Self-Sparkle

Allowed exactly once per user lifetime. The first attempt succeeds, is recorded in the sparkles table, and the bot calls it out with a funny message. Subsequent attempts are blocked -- the sparkle is NOT recorded, but the attempt count increments. The bot responds with escalating shame that includes the attempt count.

Example: "This is your 7th time trying to sparkle yourself, @manjur. We're concerned."

Tracked in the `self_sparkle_attempts` table.

#### Bot-Sparkle

Sparkling a bot is accepted and counts. The bot responds with a quirky acknowledgment. Stored in the sparkles table like any other sparkle.

#### First Sparkle Celebration

When a user receives their very first sparkle ever, the confirmation includes special celebration text inline (single message, not a separate message).

### Aggregation Window

Sparkles for the same recipient in the same channel are batched into a single confirmation message.

- **Initial wait:** 15 seconds after the first sparkle
- **Extension:** Each additional sparkle for the same recipient+channel extends the window by 15 seconds
- **Max cap:** 2 minutes total

When the window closes, a single confirmation is posted:

```
@someone just got 10 sparkles! (total: 47)

  alice: great presentation
  bob: awesome presentation
  carol: killed it
  dave, eve, frank, grace, henry, iris, jack
```

Givers with reasons are listed individually. Givers without reasons are grouped on a single line. Only the receiver is `@` mentioned.

**Implementation:** `batcher.js` maintains an in-memory map of pending batches keyed by `{receiver_id, channel_id}`. Each batch holds an array of sparkle records and a timer. On each new sparkle, the timer resets (up to max cap). When the timer fires, the batch is flushed and the confirmation message is posted.

### Web Dashboard

Express server serving HTMX + EJS templates. Authenticated via Slack OAuth ("Sign in with Slack").

#### Pages

1. **Leaderboard** -- All-time sparkle rankings with totals. Same data as `.sparkles` but in a richer visual format with sorting via HTMX.

2. **Personal History** -- Requires login. Shows sparkles you've received (who, reason, when) and sparkles you've given. Two tabs or sections.

3. **Recent Activity Feed** -- Live-ish feed of recent sparkles across the workspace. Who sparkled who, when, why. Polls for updates via HTMX.

4. **Channel Stats** -- Which channels have the most sparkle activity. Rankings by total sparkles given in each channel.

#### Branding

Dashboard colors and logo are configurable via env vars. The EJS layout template reads branding config and applies it as CSS custom properties.

## Personalization

All personalization is configured via environment variables, settable through Helm values.

| Setting | Env Var | Default |
|---------|---------|---------|
| Currency name | `SPARKLE_CURRENCY` | `sparkle` |
| Currency plural | `SPARKLE_CURRENCY_PLURAL` | `sparkles` |
| Display emoji | `SPARKLE_EMOJI` | (sparkles emoji) |
| Personality | `SPARKLE_PERSONALITY` | `playful` |
| Brand primary color | `SPARKLE_COLOR_PRIMARY` | `#6C5CE7` |
| Brand accent color | `SPARKLE_COLOR_ACCENT` | `#FFEAA7` |
| Company logo URL | `SPARKLE_LOGO_URL` | (sparklebot default) |
| Party lookback | `SPARKLE_PARTY_MINUTES` | `30` |
| Batch initial wait | `SPARKLE_BATCH_INITIAL_SECONDS` | `15` |
| Batch extend | `SPARKLE_BATCH_EXTEND_SECONDS` | `15` |
| Batch max | `SPARKLE_BATCH_MAX_SECONDS` | `120` |

### Personality Packs

JSON files in `src/personalities/`. Selected via `SPARKLE_PERSONALITY` env var. Each file contains message arrays for:

- `encouragement` -- sparkle confirmation messages (randomly selected)
- `selfSparkleShame` -- escalating messages for repeat self-sparkle attempts
- `botSparkleQuips` -- messages when someone sparkles a bot
- `firstSparkleCelebration` -- messages for first-ever sparkle recipients
- `partyAnnouncements` -- messages for sparkle party confirmations

Ships with four packs: **playful** (default), **professional**, **sarcastic**, **pirate**.

`messages.js` loads the selected personality file at startup and exports functions that return randomly selected messages from the appropriate array, with template variable substitution for user names, counts, etc.

## Helm Chart

Standard Helm chart in `helm/sparklebot/`.

### values.yaml highlights

```yaml
replicaCount: 1

image:
  repository: sparklebot
  tag: latest
  pullPolicy: IfNotPresent

persistence:
  enabled: true
  size: 5Gi
  storageClass: ceph-block
  accessMode: ReadWriteOnce

ingress:
  enabled: true
  className: nginx
  host: sparklebot.example.com
  tls: true

slack:
  # References to existing K8s Secret
  existingSecret: sparklebot-slack
  botTokenKey: bot-token
  signingSecretKey: signing-secret
  appTokenKey: app-token

sparkle:
  currency: sparkle
  currencyPlural: sparkles
  emoji: ""
  personality: playful
  colorPrimary: "#6C5CE7"
  colorAccent: "#FFEAA7"
  logoUrl: ""
  partyMinutes: 30
  batchInitialSeconds: 15
  batchExtendSeconds: 15
  batchMaxSeconds: 120

resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 200m
    memory: 256Mi
```

Slack tokens are referenced from an existing Kubernetes Secret (not created by the chart). All sparkle personalization settings are injected as env vars via a ConfigMap.

## Slack App Configuration

Required bot token scopes:
- `chat:write` -- Post sparkle confirmations
- `channels:history` -- Read messages for party mode and dot commands
- `groups:history` -- Same for private channels
- `users:read` -- Resolve user IDs to display names
- `im:write` -- Send DM leaderboards

Required bot events:
- `message.channels` -- Listen for `.sparkle` / `.sparkles` commands
- `message.groups` -- Same for private channels

OAuth scopes (for web dashboard "Sign in with Slack"):
- `identity.basic` -- Get user identity
- `identity.avatar` -- Get user avatar for dashboard

App must be configured for Socket Mode (requires `SLACK_APP_TOKEN` with `connections:write` scope).

## Error Handling

- **Slack API failures:** Log and drop. Do not retry sparkle confirmations. The sparkle is already recorded in the DB.
- **DB failures:** Log error, respond to user with a generic "something went wrong" message.
- **Invalid commands:** Silently ignore messages that don't match `.sparkle` or `.sparkles` patterns.
- **OAuth failures:** Redirect to an error page with a "try again" link.

## Dependencies

```json
{
  "@slack/bolt": "^4.1.0",
  "better-sqlite3": "^11.7.0",
  "express": "^4.21.0",
  "ejs": "^3.1.10",
  "cookie-session": "^2.1.0"
}
```

HTMX is loaded via CDN in the EJS layout template. No build step.
