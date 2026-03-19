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
      public/
        htmx.min.js           -- Bundled HTMX (no CDN)
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

Give a sparkle to one or more users. Reasons are optional.

**Input resolution flow:** The parser extracts user references from the message. Slack `<@U123ABC>` mention markup is resolved directly to a user ID. Plain text like `@mkhan` or `mkhan` triggers a Slack API lookup (`users:read`) to find a matching user. If the lookup finds a match, the Slack user ID is stored. If no match is found, the raw text is stored as-is in `receiver_id` and `receiver_name` -- no error, no validation. This allows sparkling non-existent, joke, or aspirational targets (e.g., `.sparkle @obama for running a great country`).

**Reason parsing:** User mentions are consumed greedily from the start of the argument string. Everything after the last recognized user mention (whether resolved or unresolved) is the reason. Example: `.sparkle @alice @bob great work` gives both alice and bob a sparkle with reason "great work". `.sparkle @alice for the demo @bob` gives alice a sparkle with no reason and bob a sparkle with no reason (because `@bob` is parsed as a user, not part of a reason). To sparkle alice with a reason that contains an `@`, it must not match a user pattern.

**Multi-sparkle:** `.sparkle @user1 @user2 @user3 [reason]` gives each user a sparkle with the same reason. One combined confirmation message.

**Confirmation** is batched via the aggregation window (see below) and posted in-channel. The receiver is `@` mentioned. Givers are shown by display name only (no `@` mentions, no extra notifications).

#### `.sparkle party`

Sparkle everyone who posted in the channel within the last N minutes (default: 30, configurable via `SPARKLE_PARTY_MINUTES`). The triggerer is excluded. Bot messages are excluded from the history lookup. No minutes argument -- the lookback window is configured via env var, not user-facing.

If nobody else posted in the lookback window, the bot responds with a message like "No one to party with! Post something first."

Party sparkles go through the same aggregation window as regular sparkles. Since all party sparkles share the same channel but have different recipients, each recipient gets their own aggregation batch. However, the party confirmation itself is a single message listing everyone who got sparkled -- it bypasses per-recipient batching and posts immediately as a party-specific format.

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

#### Visual Direction

Dark & Premium theme. Deep dark background, subtle glass effects, gradient accents. Inspired by Linear, Raycast, Vercel dashboard.

#### Design Tokens

All colors are derived from brand config so the theme adapts to any company's branding.

| Token | Default | Purpose |
|-------|---------|---------|
| `--bg-base` | `#0f0f23` | Page background |
| `--bg-sidebar` | `rgba(255,255,255,0.03)` | Sidebar background |
| `--bg-card` | `rgba(255,255,255,0.04)` | Card/surface background |
| `--border` | `rgba(255,255,255,0.06)` | Card and divider borders |
| `--text-primary` | `#ffffff` | Primary text |
| `--text-secondary` | `rgba(255,255,255,0.4)` | Secondary/label text |
| `--text-muted` | `rgba(255,255,255,0.3)` | Timestamps, rank numbers |
| `--accent` | `var(--color-primary)` | Active states, highlights (from `SPARKLE_COLOR_PRIMARY`) |
| `--accent-light` | derived | 12% opacity version for active nav backgrounds |
| `--accent-gradient` | `linear-gradient(135deg, var(--color-primary), var(--color-accent))` | Badges, top-rank avatars |
| `--radius-sm` | `6px` | Buttons, pills |
| `--radius-md` | `10px` | Cards |
| `--radius-lg` | `12px` | Content containers |

#### Layout

Left sidebar + content area.

**Sidebar (fixed):**
- Logo + app name at top
- Nav links with emoji icons: Leaderboard, Activity, Channels, My Sparkles
- Active link: accent-colored text on `--accent-light` background, rounded
- User avatar (initials in gradient circle) + name at bottom
- **Mobile (< 768px):** Sidebar hidden by default. Hamburger icon in top-left of content area. Tapping opens sidebar as a full-height overlay with backdrop. Tapping a nav link or outside closes it.

**Content area:** Scrollable, padded. Page title + subtitle at top.

#### Pages

**1. Leaderboard**

Podium section for top 3, then compact list for ranks 4-10.

- Top 3 as side-by-side podium cards: 2nd | 1st | 3rd. Center card (1st) is slightly elevated with accent gradient border and glow shadow.
- Each podium card: medal emoji, avatar circle (gradient background, initials), name, sparkle count. 1st place count in accent color.
- Ranks 4-10: compact rows in a bordered container. Each row: rank number, small avatar, name, count. Minimal styling.

**2. Activity Feed**

Card stream of recent sparkles across the workspace.

- Each card: horizontal layout with giver avatar, "giver sparkled receiver" text, reason in italics (if provided), channel name, and relative timestamp.
- Party events: warm gold accent border (`rgba(245,158,11,0.12)`), party emoji avatar, "user threw a sparkle party" text, participant count.
- "Live" indicator badge in the page header. HTMX polls for new items (appends to top of list).

**3. Channel Stats**

Horizontal bar chart ranking channels by total sparkle activity.

- Each row: channel name (left), sparkle count (right), gradient-filled progress bar below.
- Bars use `--accent-gradient`, sized proportionally to the highest channel.
- Sorted by count descending.

**4. My Sparkles (requires login)**

Personal dashboard with stats summary and history.

- Three stat cards at top in a row: Received (accent background), Given, Rank. Large number centered, label below.
- Pill tabs below: "Received" (default active) | "Given". Tab switching via HTMX (partial page swap, no full reload).
- Card stream below tabs (same component style as Activity feed): avatar, "From user" or "To user", reason, timestamp.

#### Branding

Dashboard colors and logo are configurable via env vars. The EJS layout template injects branding config as CSS custom properties on `:root`, so all design tokens adapt automatically. The `--accent-gradient` uses both primary and accent colors for visual depth.

## Personalization

All personalization is configured via environment variables, settable through Helm values.

**Commands are always `.sparkle` and `.sparkles` regardless of `SPARKLE_CURRENCY`.** The currency name only affects response text (e.g., "alice just got 3 kudos!") and the web dashboard labels. This keeps commands consistent and predictable across deployments.

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
  oauthClientIdKey: oauth-client-id
  oauthClientSecretKey: oauth-client-secret
  sessionSecretKey: session-secret

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

DM commands are not supported. The bot only listens in channels it has been invited to. (`message.im` is not subscribed.)

OAuth scopes (for web dashboard "Sign in with Slack"):
- `identity.basic` -- Get user identity
- `identity.avatar` -- Get user avatar for dashboard

The web dashboard requires a **Slack OAuth Client ID and Client Secret** (from the Slack app's OAuth & Permissions page). These are separate from the bot token and app token.

App must be configured for Socket Mode (requires `SLACK_APP_TOKEN` with `connections:write` scope).

## Operational Concerns

### Health Probes

Express serves `GET /healthz` returning 200. Used for both liveness and readiness probes in the K8s deployment.

### Graceful Shutdown

On SIGTERM, the bot flushes all pending aggregation batches (posts confirmations immediately) before exiting. Sparkles are already written to the DB when received, so even an unclean shutdown only loses confirmation messages, not data.

### Single Replica Only

SQLite does not support concurrent writers. Do not scale beyond `replicaCount: 1`. This is documented in the Helm values.

### Session Management

`cookie-session` stores the Slack user ID and display name after OAuth. Session secret is configured via `SPARKLE_SESSION_SECRET` env var (required, sourced from the existing K8s secret). Cookies are `httpOnly`, `secure` (when behind TLS), `sameSite: lax`, with a 7-day expiry.

## Error Handling

- **Slack API failures:** Log and drop. Do not retry sparkle confirmations. The sparkle is already recorded in the DB.
- **DB failures:** Log error, respond to user with a generic "something went wrong" message.
- **Invalid commands:** Silently ignore messages that don't match `.sparkle` or `.sparkles` patterns.
- **OAuth failures:** Redirect to an error page with a "try again" link.
- **Party mode in uninvited channel:** Bot cannot read history from channels it hasn't been invited to. If `channels.history` fails, respond with "Invite me to this channel first!"

## Dependencies

```json
{
  "@slack/bolt": "^4.1.0",
  "better-sqlite3": "^12.6.2",
  "express": "^5.1.0",
  "ejs": "^3.1.10",
  "cookie-session": "^2.1.0"
}
```

HTMX v2.0.4 is bundled as a static asset in `src/web/public/htmx.min.js` and served by Express. No CDN dependency, works in network-restricted environments. No build step.

## Dockerfile

Multi-stage build using `node:22-alpine`.

```dockerfile
# Build stage -- install deps with native compilation support
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Runtime stage -- minimal image
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY src/ ./src/
EXPOSE 3000
USER node
CMD ["node", "src/app.js"]
```

`better-sqlite3` requires native compilation (python3, make, g++), isolated to the build stage. Runtime image stays small.

## Project Files

### .gitignore

```
node_modules/
.env
data/
.superpowers/
*.db
*.db-journal
*.db-wal
```

### .env.example

```bash
# Slack App (required)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Slack OAuth (required for web dashboard)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret

# Session (required)
SPARKLE_SESSION_SECRET=random-secret-string

# Server
PORT=3000

# Personalization (all optional, defaults shown)
SPARKLE_CURRENCY=sparkle
SPARKLE_CURRENCY_PLURAL=sparkles
SPARKLE_EMOJI=
SPARKLE_PERSONALITY=playful
SPARKLE_COLOR_PRIMARY=#6C5CE7
SPARKLE_COLOR_ACCENT=#FFEAA7
SPARKLE_LOGO_URL=
SPARKLE_PARTY_MINUTES=30
SPARKLE_BATCH_INITIAL_SECONDS=15
SPARKLE_BATCH_EXTEND_SECONDS=15
SPARKLE_BATCH_MAX_SECONDS=120
```
