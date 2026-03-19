# Sparklebot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Slack peer recognition bot with dot commands, aggregation batching, personality packs, and a dark-themed HTMX web dashboard.

**Architecture:** Single Node.js container running Bolt SDK (Socket Mode) for Slack + Express for the web dashboard. SQLite via better-sqlite3 for persistence. HTMX + EJS for server-rendered interactive dashboard. Deployed via Helm chart.

**Tech Stack:** Node.js 22, @slack/bolt 4.x, better-sqlite3 12.x, Express 5.x, EJS 3.x, HTMX 2.0.4, cookie-session, Helm 3

**Spec:** `docs/superpowers/specs/2026-03-19-sparklebot-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/config.js` | Load and validate all env vars, export config object |
| `src/db.js` | SQLite connection, schema migration, query functions |
| `src/messages.js` | Load personality pack, template substitution, random message selection |
| `src/batcher.js` | Aggregation window: collect sparkles, manage timers, flush batches |
| `src/handlers/sparkle.js` | Parse `.sparkle` commands, resolve users, record sparkles, trigger batcher |
| `src/formatter.js` | Format batch confirmation messages for Slack |
| `src/handlers/leaderboard.js` | Parse `.sparkles` command, query DB, format and DM leaderboard |
| `src/web/auth.js` | Slack OAuth routes: login, callback, logout, session management |
| `src/web/routes.js` | Dashboard Express routes: leaderboard, feed, channels, history, health, HTMX partials |
| `src/web/views/layout.ejs` | Base HTML shell: sidebar, nav, branding CSS vars, HTMX script, mobile hamburger |
| `src/web/views/leaderboard.ejs` | Podium top 3 + compact list 4-10 |
| `src/web/views/feed.ejs` | Card stream of recent sparkles, HTMX polling |
| `src/web/views/channels.ejs` | Horizontal bar chart of channel activity |
| `src/web/views/history.ejs` | Personal stats cards + received/given tabs |
| `src/web/views/partials/sparkle-card.ejs` | Reusable sparkle card component (used in feed + history) |
| `src/web/views/login.ejs` | Slack OAuth login page |
| `src/web/views/error.ejs` | OAuth/general error page with retry link |
| `src/web/public/htmx.min.js` | Bundled HTMX 2.0.4 (downloaded, not CDN) |
| `src/web/public/style.css` | Dashboard CSS: design tokens, layout, components, responsive |
| `src/personalities/playful.json` | Default personality pack |
| `src/personalities/professional.json` | Corporate personality pack |
| `src/personalities/sarcastic.json` | Dry humor personality pack |
| `src/personalities/pirate.json` | Themed personality pack |
| `src/app.js` | Wire everything: Bolt app, Express server, socket mode, graceful shutdown |
| `Dockerfile` | Multi-stage build: alpine + native deps for build, minimal runtime |
| `.env.example` | Documented env var template |
| `.gitignore` | Ignore node_modules, .env, data/, .superpowers/, *.db |
| `helm/sparklebot/Chart.yaml` | Helm chart metadata |
| `helm/sparklebot/values.yaml` | Default values: image, persistence, ingress, slack secrets, sparkle config |
| `helm/sparklebot/templates/deployment.yaml` | Pod spec with env vars, probes, volume mount |
| `helm/sparklebot/templates/service.yaml` | ClusterIP service for Express port |
| `helm/sparklebot/templates/pvc.yaml` | PersistentVolumeClaim for SQLite |
| `helm/sparklebot/templates/ingress.yaml` | Optional ingress for web dashboard |
| `helm/sparklebot/templates/configmap.yaml` | Sparkle personalization env vars |
| `helm/sparklebot/templates/_helpers.tpl` | Helm template helpers (labels, names) |
| `tests/config.test.js` | Config loading and defaults |
| `tests/db.test.js` | Schema creation, CRUD operations |
| `tests/messages.test.js` | Personality loading, template substitution |
| `tests/batcher.test.js` | Aggregation window timing and flush behavior |
| `tests/formatter.test.js` | Batch confirmation message formatting |
| `tests/handlers/sparkle.test.js` | Command parsing, user resolution |
| `tests/handlers/sparkle-integration.test.js` | Handler orchestration: DB writes, batcher, self-sparkle, party mode |
| `tests/handlers/leaderboard.test.js` | Leaderboard query and formatting |

---

### Task 1: Project Scaffolding and Config

**Files:**
- Create: `.gitignore`, `.env.example`, `src/config.js`, `tests/config.test.js`
- Create/Modify: `package.json` (already exists with name, version, scripts, deps -- add `"type": "module"`, devDependencies, test scripts)

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.env
data/
.superpowers/
*.db
*.db-journal
*.db-wal
```

- [ ] **Step 2: Create `.env.example`**

Copy the full `.env.example` content from the spec (lines 463-491).

- [ ] **Step 3: Update `package.json` with all dependencies and test script**

Add dependencies: `@slack/bolt ^4.1.0`, `better-sqlite3 ^12.6.2`, `express ^5.1.0`, `ejs ^3.1.10`, `cookie-session ^2.1.0`. Add devDependencies: `vitest`. Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Run `npm install`**

Run: `cd /Users/manjur/Documents/000-harmoni/sparklebot && npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 5: Write config test**

Create `tests/config.test.js`. Test that `config.js` returns correct defaults when no env vars are set, and overrides when env vars are provided. Test: `currency`, `currencyPlural`, `personality`, `colorPrimary`, `colorAccent`, `partyMinutes`, `batchInitialSeconds`, `batchExtendSeconds`, `batchMaxSeconds`, `port`.

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all SPARKLE_ vars
    Object.keys(process.env).forEach(k => {
      if (k.startsWith('SPARKLE_')) delete process.env[k];
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when no env vars set', async () => {
    // Dynamic import to pick up env changes
    const { default: loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.currency).toBe('sparkle');
    expect(config.currencyPlural).toBe('sparkles');
    expect(config.personality).toBe('playful');
    expect(config.colorPrimary).toBe('#6C5CE7');
    expect(config.colorAccent).toBe('#FFEAA7');
    expect(config.partyMinutes).toBe(30);
    expect(config.batchInitialSeconds).toBe(15);
    expect(config.batchExtendSeconds).toBe(15);
    expect(config.batchMaxSeconds).toBe(120);
    expect(config.port).toBe(3000);
  });

  it('overrides from env vars', async () => {
    process.env.SPARKLE_CURRENCY = 'kudos';
    process.env.SPARKLE_CURRENCY_PLURAL = 'kudos';
    process.env.SPARKLE_PERSONALITY = 'pirate';
    process.env.SPARKLE_COLOR_PRIMARY = '#FF0000';
    process.env.SPARKLE_PARTY_MINUTES = '60';
    process.env.PORT = '8080';
    const { default: loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.currency).toBe('kudos');
    expect(config.personality).toBe('pirate');
    expect(config.colorPrimary).toBe('#FF0000');
    expect(config.partyMinutes).toBe(60);
    expect(config.port).toBe(8080);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/config.test.js`
Expected: FAIL -- `src/config.js` does not exist.

- [ ] **Step 7: Write `src/config.js`**

```javascript
export default function loadConfig() {
  return {
    // Slack
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    sessionSecret: process.env.SPARKLE_SESSION_SECRET || 'change-me',

    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    dbPath: process.env.SPARKLE_DB_PATH || null, // null = default to data/sparklebot.db in app.js

    // Personalization
    currency: process.env.SPARKLE_CURRENCY || 'sparkle',
    currencyPlural: process.env.SPARKLE_CURRENCY_PLURAL || 'sparkles',
    emoji: process.env.SPARKLE_EMOJI || '\u2728',
    personality: process.env.SPARKLE_PERSONALITY || 'playful',
    colorPrimary: process.env.SPARKLE_COLOR_PRIMARY || '#6C5CE7',
    colorAccent: process.env.SPARKLE_COLOR_ACCENT || '#FFEAA7',
    logoUrl: process.env.SPARKLE_LOGO_URL || '',

    // Behavior
    partyMinutes: parseInt(process.env.SPARKLE_PARTY_MINUTES || '30', 10),
    batchInitialSeconds: parseInt(process.env.SPARKLE_BATCH_INITIAL_SECONDS || '15', 10),
    batchExtendSeconds: parseInt(process.env.SPARKLE_BATCH_EXTEND_SECONDS || '15', 10),
    batchMaxSeconds: parseInt(process.env.SPARKLE_BATCH_MAX_SECONDS || '120', 10),
  };
}
```

- [ ] **Step 8: Add `"type": "module"` to `package.json`**

Required for ES module imports (vitest and our code use `import`/`export`).

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.js`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add .gitignore .env.example package.json package-lock.json src/config.js tests/config.test.js
git commit -m "feat: project scaffolding, config module with tests"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db.js`, `tests/db.test.js`

- [ ] **Step 1: Write database tests**

Create `tests/db.test.js`. Test schema creation, sparkle CRUD (insert, query by receiver, query by giver, leaderboard top N, channel stats), self-sparkle tracking (first attempt succeeds, subsequent increment), and total count for a user.

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';

describe('db', () => {
  let db;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  describe('sparkles', () => {
    it('inserts and retrieves a sparkle', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', reason: 'great work', channelId: 'C1' });
      const sparkles = db.getSparklesReceived('U2', 10);
      expect(sparkles).toHaveLength(1);
      expect(sparkles[0].giver_id).toBe('U1');
      expect(sparkles[0].reason).toBe('great work');
    });

    it('returns leaderboard sorted by count descending', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'carol', channelId: 'C1' });
      const board = db.getLeaderboard(10);
      expect(board[0].receiver_id).toBe('U2');
      expect(board[0].count).toBe(2);
      expect(board[1].receiver_id).toBe('U3');
    });

    it('returns user rank and count', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'carol', channelId: 'C1' });
      const rank = db.getUserRank('U3');
      expect(rank.rank).toBe(2);
      expect(rank.count).toBe(1);
    });

    it('returns channel stats sorted by count', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'carol', channelId: 'C2' });
      const stats = db.getChannelStats();
      expect(stats[0].channel_id).toBe('C1');
      expect(stats[0].count).toBe(2);
    });

    it('returns sparkles given by a user', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', reason: 'nice', channelId: 'C1' });
      const given = db.getSparklesGiven('U1', 10);
      expect(given).toHaveLength(1);
      expect(given[0].receiver_id).toBe('U2');
    });

    it('returns total received count for a user', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U3', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      expect(db.getTotalReceived('U2')).toBe(2);
    });

    it('returns total given count for a user', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      expect(db.getTotalGiven('U1')).toBe(1);
    });

    it('detects first sparkle for a receiver', () => {
      expect(db.isFirstSparkle('U2')).toBe(true);
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      expect(db.isFirstSparkle('U2')).toBe(false);
    });

    it('returns recent activity feed', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', reason: 'nice', channelId: 'C1' });
      const feed = db.getRecentActivity(50);
      expect(feed).toHaveLength(1);
      expect(feed[0].giver_id).toBe('U1');
    });
  });

  describe('self_sparkle_attempts', () => {
    it('records first attempt as succeeded', () => {
      const result = db.recordSelfSparkle('U1');
      expect(result.firstTime).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('increments attempt count on subsequent tries', () => {
      db.recordSelfSparkle('U1');
      const result = db.recordSelfSparkle('U1');
      expect(result.firstTime).toBe(false);
      expect(result.attempts).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL -- `src/db.js` does not exist.

- [ ] **Step 3: Write `src/db.js`**

Implement `createDb(dbPath)` that returns an object with all query methods. On creation: open database, enable WAL mode, create tables if not exist, prepare all statements.

Methods: `insertSparkle({ giverId, receiverId, receiverName, reason, channelId })`, `getLeaderboard(limit)`, `getUserRank(userId)`, `getSparklesReceived(userId, limit)`, `getSparklesGiven(userId, limit)`, `getTotalReceived(userId)`, `getTotalGiven(userId)`, `isFirstSparkle(receiverId)`, `getChannelStats()`, `getRecentActivity(limit)`, `recordSelfSparkle(userId)`, `close()`.

Use prepared statements for all queries. Schema matches spec exactly (lines 78-100).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: database layer with SQLite schema and query functions"
```

---

### Task 3: Personality Packs and Messages

**Files:**
- Create: `src/messages.js`, `src/personalities/playful.json`, `src/personalities/professional.json`, `src/personalities/sarcastic.json`, `src/personalities/pirate.json`, `tests/messages.test.js`

- [ ] **Step 1: Write message tests**

Test: loading a personality by name, random selection returns a string from the array, template substitution replaces `{user}`, `{count}`, `{currency}` placeholders, unknown personality falls back to playful.

```javascript
import { describe, it, expect } from 'vitest';
import { createMessages } from '../src/messages.js';

describe('messages', () => {
  it('loads playful personality by default', () => {
    const msg = createMessages('playful');
    expect(msg.encouragement({ user: 'bob', count: 5, currency: 'sparkles' })).toBeTruthy();
  });

  it('substitutes template variables', () => {
    const msg = createMessages('playful');
    const text = msg.encouragement({ user: 'alice', count: 10, currency: 'sparkles' });
    // Should contain the user name or count somewhere in output
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('loads pirate personality', () => {
    const msg = createMessages('pirate');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'doubloons' })).toBeTruthy();
  });

  it('falls back to playful for unknown personality', () => {
    const msg = createMessages('nonexistent');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'sparkles' })).toBeTruthy();
  });

  it('returns self-sparkle shame messages', () => {
    const msg = createMessages('playful');
    const text = msg.selfSparkleShame({ user: 'bob', attempts: 3 });
    expect(typeof text).toBe('string');
  });

  it('returns bot sparkle quips', () => {
    const msg = createMessages('playful');
    const text = msg.botSparkleQuip({ user: 'bot', giver: 'alice' });
    expect(typeof text).toBe('string');
  });

  it('returns first sparkle celebration', () => {
    const msg = createMessages('playful');
    const text = msg.firstSparkleCelebration({ user: 'bob', giver: 'alice' });
    expect(typeof text).toBe('string');
  });

  it('returns party announcements', () => {
    const msg = createMessages('playful');
    const text = msg.partyAnnouncement({ user: 'alice', count: 8, channel: '#general' });
    expect(typeof text).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/messages.test.js`
Expected: FAIL

- [ ] **Step 3: Create all four personality JSON files**

Each file has the same structure with arrays for: `encouragement`, `selfSparkleShame`, `botSparkleQuips`, `firstSparkleCelebration`, `partyAnnouncements`. Messages use `{user}`, `{count}`, `{currency}`, `{giver}`, `{channel}`, `{attempts}` placeholders.

Write 8-12 messages per array for `playful.json`. Write 4-6 per array for the other three packs.

Example `playful.json` structure:
```json
{
  "encouragement": [
    "Boo-yah! {giver} just gave {user} a {currency}! That's {count} total!",
    "Holy guacamole! {user} earned a {currency} from {giver}! ({count} total)",
    ...
  ],
  "selfSparkleShame": [
    "Oh {user}... you just sparkled yourself. That's allowed exactly once. Enjoy it.",
    "Really, {user}? This is attempt #{attempts} to self-sparkle. We're keeping count.",
    ...
  ],
  ...
}
```

- [ ] **Step 4: Write `src/messages.js`**

Export `createMessages(personalityName)` that loads the JSON file, falls back to playful if not found, and returns an object with methods: `encouragement(vars)`, `selfSparkleShame(vars)`, `botSparkleQuip(vars)`, `firstSparkleCelebration(vars)`, `partyAnnouncement(vars)`. Each method picks a random message from the array and substitutes `{key}` placeholders from the vars object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/messages.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/messages.js src/personalities/ tests/messages.test.js
git commit -m "feat: personality packs and message system"
```

---

### Task 4: Aggregation Batcher

**Files:**
- Create: `src/batcher.js`, `tests/batcher.test.js`

- [ ] **Step 1: Write batcher tests**

Test: adding a sparkle starts a timer, adding a second sparkle for the same recipient+channel extends the timer, timer fires and calls flush callback, max cap is enforced, different recipients get separate batches, `flushAll()` immediately flushes everything (for graceful shutdown).

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBatcher } from '../src/batcher.js';

describe('batcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllTimers(); });

  it('flushes after initial wait with single sparkle', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice', reason: 'nice' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch = onFlush.mock.calls[0][0];
    expect(batch.receiverId).toBe('U1');
    expect(batch.channelId).toBe('C1');
    expect(batch.sparkles).toHaveLength(1);
  });

  it('extends timer when second sparkle arrives', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    vi.advanceTimersByTime(1000); // 1s in
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U3', giverName: 'bob' });

    vi.advanceTimersByTime(1500); // 2.5s total -- original timer would fire but was extended
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000); // 3.5s total -- extended timer fires at 3s
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sparkles).toHaveLength(2);
  });

  it('respects max cap', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 5 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    // Keep extending past max
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U3', giverName: 'bob' });
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U4', giverName: 'carol' });
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U5', giverName: 'dave' });

    // Should flush at 5s from first sparkle regardless of extensions
    vi.advanceTimersByTime(1000); // 5.5s total
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sparkles).toHaveLength(4);
  });

  it('keeps separate batches for different recipients', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U3', channelId: 'C1', giverId: 'U2', giverName: 'alice' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('keeps separate batches for different channels', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U1', channelId: 'C2', giverId: 'U3', giverName: 'bob' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('flushAll immediately flushes all pending batches', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 15, extendSeconds: 15, maxSeconds: 120 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U3', channelId: 'C1', giverId: 'U4', giverName: 'bob' });

    batcher.flushAll();
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/batcher.test.js`
Expected: FAIL

- [ ] **Step 3: Write `src/batcher.js`**

Export `createBatcher(config, onFlush)`. Maintains a `Map` keyed by `receiverId:channelId`. Each entry: `{ sparkles: [], timer: null, startTime: Date.now() }`. On `add()`: append sparkle, clear existing timer, set new timer for `min(extendSeconds, maxSeconds - elapsed)`. On flush: call `onFlush(batch)` with `{ receiverId, channelId, sparkles }`, delete entry. `flushAll()` iterates all entries and flushes immediately.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/batcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/batcher.js tests/batcher.test.js
git commit -m "feat: aggregation batcher with rolling window"
```

---

### Task 5: Sparkle Command Handler

**Files:**
- Create: `src/handlers/sparkle.js`, `tests/handlers/sparkle.test.js`

- [ ] **Step 1: Write sparkle handler tests**

Test the command parser and handler logic in isolation (mock db, batcher, Slack client). Test cases:

1. Parse `.sparkle <@U123> great work` -- extracts user ID `U123`, reason `great work`
2. Parse `.sparkle <@U1> <@U2> <@U3> nice job` -- extracts 3 user IDs, reason `nice job`
3. Parse `.sparkle bob` -- plain text, no Slack mention markup
4. Parse `.sparkle <@U1>` -- no reason
5. Self-sparkle: first time succeeds and records
6. Self-sparkle: second time blocks and increments
7. Bot-sparkle: accepted with quip
8. Party mode: fetches channel history, sparkles all recent posters except triggerer and bots
9. Party mode: empty channel responds with "no one to party with"
10. Ignores messages that don't start with `.sparkle`

```javascript
import { describe, it, expect, vi } from 'vitest';
import { parseSparkleCommand, handleSparkle } from '../src/handlers/sparkle.js';

describe('parseSparkleCommand', () => {
  it('parses single mention with reason', () => {
    const result = parseSparkleCommand('.sparkle <@U123> great work');
    expect(result.targets).toEqual([{ id: 'U123', raw: '<@U123>' }]);
    expect(result.reason).toBe('great work');
    expect(result.isParty).toBe(false);
  });

  it('parses multiple mentions with reason', () => {
    const result = parseSparkleCommand('.sparkle <@U1> <@U2> <@U3> nice job');
    expect(result.targets).toHaveLength(3);
    expect(result.reason).toBe('nice job');
  });

  it('parses plain text target', () => {
    const result = parseSparkleCommand('.sparkle bob for being awesome');
    expect(result.targets).toEqual([{ id: null, raw: 'bob' }]);
    expect(result.reason).toBe('for being awesome');
  });

  it('parses mention with no reason', () => {
    const result = parseSparkleCommand('.sparkle <@U123>');
    expect(result.targets).toEqual([{ id: 'U123', raw: '<@U123>' }]);
    expect(result.reason).toBe(null);
  });

  it('parses party command', () => {
    const result = parseSparkleCommand('.sparkle party');
    expect(result.isParty).toBe(true);
    expect(result.targets).toEqual([]);
  });

  it('returns null for non-sparkle messages', () => {
    expect(parseSparkleCommand('hello world')).toBe(null);
    expect(parseSparkleCommand('.sparkles')).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/handlers/sparkle.test.js`
Expected: FAIL

- [ ] **Step 3: Write `src/handlers/sparkle.js`**

Export `parseSparkleCommand(text)` and `handleSparkle({ message, client, db, batcher, messages, config })`.

Parser: regex for `.sparkle` at start. Detect `party` keyword. Extract `<@UXXXX>` patterns and plain text words as targets. Everything after the last target is the reason (trimmed, null if empty).

Handler: for each target, resolve user (Slack API lookup for plain text, direct for `<@U>` markup), check self-sparkle rules, check if bot, check first sparkle, insert into DB, add to batcher. For party: call `conversations.history` to get recent messages, extract unique user IDs, exclude triggerer and bots, sparkle each one with a party-specific confirmation that bypasses batching.

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `npx vitest run tests/handlers/sparkle.test.js`
Expected: PASS

- [ ] **Step 5: Write handler integration tests**

Create `tests/handlers/sparkle-integration.test.js`. These test `handleSparkle` with a real in-memory DB but mocked Slack client and batcher.

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSparkle } from '../../src/handlers/sparkle.js';
import { createDb } from '../../src/db.js';
import { createMessages } from '../../src/messages.js';
import loadConfig from '../../src/config.js';

describe('handleSparkle integration', () => {
  let db, messages, config, mockClient, mockBatcher;

  beforeEach(() => {
    db = createDb(':memory:');
    messages = createMessages('playful');
    config = loadConfig();
    mockClient = {
      users: { list: vi.fn().mockResolvedValue({ members: [] }) },
      conversations: { history: vi.fn(), open: vi.fn() },
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
    };
    mockBatcher = { add: vi.fn() };
  });

  it('records sparkle and adds to batcher', async () => {
    const message = { text: '.sparkle <@U2> great work', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(mockBatcher.add).toHaveBeenCalledTimes(1);
    expect(db.getTotalReceived('U2')).toBe(1);
  });

  it('allows self-sparkle first time, blocks second', async () => {
    const message = { text: '.sparkle <@U1> self love', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1); // first time succeeds

    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1); // second time blocked
    // Bot posts shame message directly (not through batcher)
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
  });

  it('detects first sparkle for a user', async () => {
    const message = { text: '.sparkle <@U2>', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    // First sparkle flag should be set in the batcher add call
    const addCall = mockBatcher.add.mock.calls[0][0];
    expect(addCall.isFirstSparkle).toBe(true);
  });

  it('handles party mode with recent posters', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [
        { user: 'U2', ts: '1234', bot_id: undefined },
        { user: 'U3', ts: '1235', bot_id: undefined },
        { user: 'U1', ts: '1236', bot_id: undefined }, // triggerer, should be excluded
        { user: 'UBOT', ts: '1237', bot_id: 'B1' },   // bot, should be excluded
      ],
    });
    const message = { text: '.sparkle party', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    // Should sparkle U2 and U3, not U1 (triggerer) or UBOT (bot)
    expect(db.getTotalReceived('U2')).toBe(1);
    expect(db.getTotalReceived('U3')).toBe(1);
    expect(db.getTotalReceived('U1')).toBe(0);
    expect(db.getTotalReceived('UBOT')).toBe(0);
    // Party posts its own confirmation (bypasses batcher)
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
  });

  it('handles party mode with empty channel', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [{ user: 'U1', ts: '1234' }], // only the triggerer
    });
    const message = { text: '.sparkle party', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    // Should post "no one to party with" message
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    expect(call.text.toLowerCase()).toContain('no one');
  });
});
```

- [ ] **Step 6: Run all sparkle tests**

Run: `npx vitest run tests/handlers/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/handlers/sparkle.js tests/handlers/sparkle.test.js tests/handlers/sparkle-integration.test.js
git commit -m "feat: sparkle command parser and handler with integration tests"
```

---

### Task 6: Leaderboard Command Handler

**Files:**
- Create: `src/handlers/leaderboard.js`, `tests/handlers/leaderboard.test.js`

- [ ] **Step 1: Write leaderboard handler tests**

Test formatting: top 10 with medals for top 3, user's rank shown if not in top 10, uses currency name from config.

```javascript
import { describe, it, expect } from 'vitest';
import { formatLeaderboard } from '../src/handlers/leaderboard.js';

describe('formatLeaderboard', () => {
  const board = [
    { receiver_id: 'U1', receiver_name: 'alice', count: 42 },
    { receiver_id: 'U2', receiver_name: 'bob', count: 38 },
    { receiver_id: 'U3', receiver_name: 'carol', count: 31 },
    { receiver_id: 'U4', receiver_name: 'dave', count: 25 },
  ];

  it('formats leaderboard with medals for top 3', () => {
    const text = formatLeaderboard(board, { userId: 'U1', rank: 1, count: 42 }, 'sparkles');
    expect(text).toContain('\uD83E\uDD47'); // gold medal
    expect(text).toContain('\uD83E\uDD48'); // silver medal
    expect(text).toContain('\uD83E\uDD49'); // bronze medal
    expect(text).toContain('alice');
    expect(text).toContain('42');
  });

  it('shows user rank when not in top 10', () => {
    const text = formatLeaderboard(board, { userId: 'U99', rank: 14, count: 5 }, 'sparkles');
    expect(text).toContain('#14');
    expect(text).toContain('5');
  });

  it('uses custom currency name', () => {
    const text = formatLeaderboard(board, { userId: 'U1', rank: 1, count: 42 }, 'kudos');
    expect(text).toContain('kudos');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/handlers/leaderboard.test.js`
Expected: FAIL

- [ ] **Step 3: Write `src/handlers/leaderboard.js`**

Export `formatLeaderboard(board, userRank, currencyPlural)` and `handleLeaderboard({ message, client, db, config })`.

Formatter: builds Slack mrkdwn text with medal emojis for top 3, numbered list for 4-10, and the requester's rank at the bottom if not in top 10. Handler: queries DB for top 10, gets requester's rank, opens DM via `conversations.open`, posts formatted leaderboard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/handlers/leaderboard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/leaderboard.js tests/handlers/leaderboard.test.js
git commit -m "feat: leaderboard command handler with DM delivery"
```

---

### Task 7: Batch Confirmation Formatter

**Files:**
- Create: `src/formatter.js`, `tests/formatter.test.js`

This module formats a flushed batch into a Slack message. Separated from `app.js` so it can be tested independently.

- [ ] **Step 1: Write formatter tests**

```javascript
import { describe, it, expect } from 'vitest';
import { formatBatchConfirmation } from '../src/formatter.js';

describe('formatBatchConfirmation', () => {
  it('formats single sparkle with reason', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [{ giverName: 'alice', reason: 'great work' }],
      totalCount: 5,
      encouragement: 'Boo-yah!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    expect(text).toContain('<@U1>');
    expect(text).toContain('alice');
    expect(text).toContain('great work');
    expect(text).toContain('5');
    expect(text).not.toContain('<@'); // givers should NOT be @ mentioned (except receiver)
  });

  it('formats multiple sparkles, groups givers without reasons', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [
        { giverName: 'alice', reason: 'great presentation' },
        { giverName: 'bob', reason: null },
        { giverName: 'carol', reason: null },
      ],
      totalCount: 10,
      encouragement: 'Holy guacamole!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    // alice should be on her own line with reason
    expect(text).toContain('alice: great presentation');
    // bob and carol should be grouped
    expect(text).toMatch(/bob.*carol|carol.*bob/);
  });

  it('handles single sparkle with no reason', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [{ giverName: 'alice', reason: null }],
      totalCount: 1,
      encouragement: 'Nice!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    expect(text).toContain('<@U1>');
    expect(text).toContain('alice');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/formatter.test.js`
Expected: FAIL

- [ ] **Step 3: Write `src/formatter.js`**

Export `formatBatchConfirmation({ receiverId, sparkles, totalCount, encouragement, currency, emoji })`.

Format per spec (lines 173-184):
```
{emoji} <@receiverId> just got {sparkles.length} {currency}! (total: {totalCount})
{encouragement}

  alice: great presentation
  bob: awesome presentation
  carol, dave, eve
```

Givers with reasons: one per line as `  {giverName}: {reason}`. Givers without reasons: grouped on a single line, comma-separated. Receiver is the only `@` mention.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/formatter.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/formatter.js tests/formatter.test.js
git commit -m "feat: batch confirmation message formatter"
```

---

### Task 8: Web Dashboard -- Layout, CSS, and Static Assets

**Files:**
- Create: `src/web/public/style.css`, `src/web/public/htmx.min.js`, `src/web/views/layout.ejs`, `src/web/views/login.ejs`, `src/web/views/error.ejs`, `src/web/views/partials/sparkle-card.ejs`

- [ ] **Step 1: Download HTMX 2.0.4 and save as static asset**

Run: `curl -o src/web/public/htmx.min.js https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js`

- [ ] **Step 2: Create `src/web/public/style.css`**

Implement the full dark premium theme from the spec. Include:

- CSS custom properties on `:root` for all design tokens (spec lines 199-213). Properties like `--color-primary` and `--color-accent` are injected via inline `<style>` in `layout.ejs` from config, so the CSS file uses `var(--color-primary)` etc.
- Layout: sidebar fixed left (220px), content area with left margin. Flexbox.
- Sidebar styles: background, nav links, active state, user avatar circle at bottom.
- Card component: background, border, radius, padding, hover state.
- Podium styles: 3-card flex row, center elevated, glow on 1st place.
- Bar chart styles: progress bars with gradient fill.
- Stat card styles: accent background for primary stat.
- Pill tab styles: active/inactive states.
- Sparkle card component (reused in feed + history).
- Typography: system-ui font stack, heading sizes, subtitle, muted text.
- Mobile responsive (< 768px): sidebar hidden, hamburger icon, overlay when open.
- Utility classes: `.avatar` (gradient circle with initials), `.medal`, `.badge`.

- [ ] **Step 3: Create `src/web/views/layout.ejs`**

Base HTML shell. Includes:
- `<!DOCTYPE html>` with dark theme meta tags
- Inline `<style>` block injecting `--color-primary` and `--color-accent` from config (so CSS can derive everything)
- Link to `/public/style.css`
- Sidebar with logo, nav links (active state based on current page), user avatar (from session if logged in, "Sign in" link if not)
- Mobile hamburger button with JS toggle
- `<%- body %>` content slot
- HTMX script tag pointing to `/public/htmx.min.js`

- [ ] **Step 4: Create `src/web/views/login.ejs`**

Simple centered page with "Sign in with Slack" button linking to `/auth/login`. Dark themed, matches the overall design.

- [ ] **Step 5: Create `src/web/views/error.ejs`**

Error page with message variable and "Try again" link. Used for OAuth failures and general errors.

- [ ] **Step 6: Create `src/web/views/partials/sparkle-card.ejs`**

Reusable partial for a single sparkle entry. Accepts: `giverName`, `receiverName`, `reason`, `channelId`, `createdAt`, `isParty`. Renders the horizontal card layout from the Activity Feed design.

- [ ] **Step 7: Verify layout renders**

Start the app, visit `http://localhost:3000`. Should see the dark sidebar with nav links and an empty content area or redirect to login.

- [ ] **Step 8: Commit**

```bash
git add src/web/public/ src/web/views/
git commit -m "feat: dashboard layout, CSS theme, static assets, login/error pages"
```

---

### Task 9: Web Dashboard -- Auth (Slack OAuth)

**Files:**
- Create: `src/web/auth.js`

- [ ] **Step 1: Write `src/web/auth.js`**

Export `setupAuth(app, config)` that registers these Express routes:

- `GET /auth/login` -- redirects to Slack OAuth authorize URL with `identity.basic,identity.avatar` scopes, client ID from config, redirect URI.
- `GET /auth/callback` -- exchanges code for token via Slack API, extracts user identity (id, name, avatar), stores in session, redirects to `/`.
- `GET /auth/logout` -- clears session, redirects to `/`.

Also export `requireAuth` middleware that checks for session user and redirects to `/auth/login` if not found (used on protected routes like My Sparkles).

- [ ] **Step 2: Smoke test auth flow**

Cannot fully test without a real Slack app, but verify:
- `/auth/login` redirects to `https://slack.com/oauth/v2/authorize` with correct params
- `/auth/logout` clears session and redirects
- `requireAuth` middleware redirects unauthenticated requests

- [ ] **Step 3: Commit**

```bash
git add src/web/auth.js
git commit -m "feat: Slack OAuth auth flow for web dashboard"
```

---

### Task 10: Web Dashboard -- Page Routes and Views

**Files:**
- Create: `src/web/routes.js`, `src/web/views/leaderboard.ejs`, `src/web/views/feed.ejs`, `src/web/views/channels.ejs`, `src/web/views/history.ejs`

- [ ] **Step 1: Write `src/web/routes.js`**

Export `setupRoutes(app, db, config)` registering:

- `GET /` -- redirect to `/leaderboard`
- `GET /leaderboard` -- query `db.getLeaderboard(10)`, render `leaderboard.ejs` with data + config (for currency name, branding)
- `GET /feed` -- query `db.getRecentActivity(50)`, render `feed.ejs`
- `GET /feed/new?after=:id` -- HTMX partial: return new sparkle cards since the given ID (for polling)
- `GET /channels` -- query `db.getChannelStats()`, render `channels.ejs`
- `GET /me` -- `requireAuth` middleware, query user's received/given/rank, render `history.ejs`
- `GET /me/received` -- HTMX partial: received sparkles tab content
- `GET /me/given` -- HTMX partial: given sparkles tab content

All routes pass `config`, `currentPage`, and `user` (from session) to templates for the layout sidebar active state and user avatar.

- [ ] **Step 2: Write `src/web/views/leaderboard.ejs`**

Extends layout. Implements the podium + list design:
- Top 3 podium section: flex row, 2nd | 1st | 3rd arrangement
- Each podium card with medal emoji, avatar, name, count
- 1st place card with accent gradient border and glow
- Ranks 4-10 in compact list below

- [ ] **Step 3: Write `src/web/views/feed.ejs`**

Extends layout. Card stream:
- Page header with "Activity" title and "Live" badge
- HTMX div with `hx-get="/feed/new?after=<latest-id>"` `hx-trigger="every 10s"` `hx-swap="afterbegin"`
- Renders sparkle-card partial for each entry
- Party events get special `.party-card` class

- [ ] **Step 4: Write `src/web/views/channels.ejs`**

Extends layout. Horizontal bar chart:
- Each channel as a row: name, count, progress bar
- Bar width as percentage of max channel count
- Gradient fill on bars

- [ ] **Step 5: Write `src/web/views/history.ejs`**

Extends layout. Personal dashboard:
- Three stat cards (received, given, rank)
- Pill tabs with HTMX: `hx-get="/me/received"` and `hx-get="/me/given"` swapping a target div
- Default tab content (received) rendered server-side on initial load

- [ ] **Step 6: Verify all pages render**

Start app, seed some test data via a quick script or by inserting directly into the DB, visit each page and confirm layout matches the mockups.

- [ ] **Step 7: Commit**

```bash
git add src/web/routes.js src/web/views/
git commit -m "feat: dashboard pages - leaderboard, feed, channels, history"
```

---

### Task 11: App Entrypoint (Bolt + Express Wiring)

**Files:**
- Create: `src/app.js`, `data/.gitkeep`

**Note:** This task depends on Tasks 8-10 (web modules). All imports must exist.

- [ ] **Step 1: Create `data/` directory with `.gitkeep`**

```bash
mkdir -p data && touch data/.gitkeep
```

- [ ] **Step 2: Write `src/app.js`**

This file wires everything together. No unit tests -- this is integration glue tested by running the app.

```javascript
import { App } from '@slack/bolt';
import express from 'express';
import cookieSession from 'cookie-session';
import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
import { createDb } from './db.js';
import { createMessages } from './messages.js';
import { createBatcher } from './batcher.js';
import { handleSparkle } from './handlers/sparkle.js';
import { handleLeaderboard } from './handlers/leaderboard.js';
import { formatBatchConfirmation } from './formatter.js';
import { setupAuth } from './web/auth.js';
import { setupRoutes } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const dbPath = config.dbPath || path.join(__dirname, '..', 'data', 'sparklebot.db');
const db = createDb(dbPath);
const messages = createMessages(config.personality);

// Express app for web dashboard
const expressApp = express();
expressApp.set('view engine', 'ejs');
expressApp.set('views', path.join(__dirname, 'web', 'views'));
expressApp.use('/public', express.static(path.join(__dirname, 'web', 'public')));
expressApp.use(cookieSession({
  name: 'sparklebot',
  secret: config.sessionSecret,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// Health probe
expressApp.get('/healthz', (req, res) => res.send('ok'));

// Auth and dashboard routes
setupAuth(expressApp, config);
setupRoutes(expressApp, db, config);

// Bolt app with Socket Mode
const boltApp = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  appToken: config.slackAppToken,
});

// Batcher flush callback -- posts confirmation to Slack
const batcher = createBatcher(
  { initialSeconds: config.batchInitialSeconds, extendSeconds: config.batchExtendSeconds, maxSeconds: config.batchMaxSeconds },
  async (batch) => {
    const totalCount = db.getTotalReceived(batch.receiverId);
    const encouragement = messages.encouragement({
      user: batch.sparkles[0]?.receiverName || batch.receiverId,
      count: totalCount,
      currency: config.currencyPlural,
    });
    const text = formatBatchConfirmation({
      receiverId: batch.receiverId,
      sparkles: batch.sparkles,
      totalCount,
      encouragement,
      currency: config.currencyPlural,
      emoji: config.emoji,
    });
    try {
      await boltApp.client.chat.postMessage({
        channel: batch.channelId,
        text,
      });
    } catch (err) {
      console.error('Failed to post batch confirmation:', err.message);
    }
  }
);

// Listen for messages
boltApp.message(async ({ message, client }) => {
  if (!message.text) return;

  if (message.text.startsWith('.sparkle ') || message.text === '.sparkle party') {
    await handleSparkle({ message, client, db, batcher, messages, config });
  } else if (message.text === '.sparkles') {
    await handleLeaderboard({ message, client, db, config });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, flushing pending batches...');
  batcher.flushAll();
  db.close();
  process.exit(0);
});

// Start
const port = config.port;
expressApp.listen(port, () => console.log(`Dashboard running on port ${port}`));
boltApp.start().then(() => console.log('Bolt app connected via Socket Mode'));
```

- [ ] **Step 3: Smoke test -- verify app starts**

Run: `PORT=3000 SPARKLE_SESSION_SECRET=test node src/app.js`
Expected: "Dashboard running on port 3000" logged. `curl localhost:3000/healthz` returns "ok". Slack connection fails (expected, no real tokens). Dashboard pages render at localhost:3000.

- [ ] **Step 4: Commit**

```bash
git add src/app.js data/.gitkeep
git commit -m "feat: app entrypoint wiring Bolt + Express + all modules"
```

---

### Task 12: Dockerfile and Helm Chart

**Files:**
- Create: `Dockerfile`, `helm/sparklebot/Chart.yaml`, `helm/sparklebot/values.yaml`, `helm/sparklebot/templates/_helpers.tpl`, `helm/sparklebot/templates/deployment.yaml`, `helm/sparklebot/templates/service.yaml`, `helm/sparklebot/templates/pvc.yaml`, `helm/sparklebot/templates/ingress.yaml`, `helm/sparklebot/templates/configmap.yaml`

- [ ] **Step 1: Create `Dockerfile`**

Multi-stage build exactly as specified in the spec (lines 427-443).

- [ ] **Step 2: Verify Docker build succeeds**

Run: `docker build -t sparklebot:dev .`
Expected: Build completes. Image is small (< 200MB).

- [ ] **Step 3: Create `helm/sparklebot/Chart.yaml`**

```yaml
apiVersion: v2
name: sparklebot
description: A lightweight Slack bot for peer recognition
type: application
version: 0.1.0
appVersion: "1.0.0"
```

- [ ] **Step 4: Create `helm/sparklebot/values.yaml`**

Copy values from spec (lines 306-356). Add comments explaining each section. Add `# WARNING: Do not scale beyond 1 replica. SQLite does not support concurrent writers.` above `replicaCount`.

- [ ] **Step 5: Create `helm/sparklebot/templates/_helpers.tpl`**

Standard helpers: `sparklebot.name`, `sparklebot.fullname`, `sparklebot.labels`, `sparklebot.selectorLabels`.

- [ ] **Step 6: Create `helm/sparklebot/templates/deployment.yaml`**

Pod spec with:
- Single container from image config
- Env vars from ConfigMap (sparkle settings) and Secret (Slack tokens, session secret)
- Volume mount for PVC at `/app/data`
- `SPARKLE_DB_PATH=/app/data/sparklebot.db` env var
- Liveness and readiness probes on `/healthz`
- Resource requests/limits from values
- `securityContext: runAsNonRoot: true`

- [ ] **Step 7: Create remaining Helm templates**

- `service.yaml` -- ClusterIP service exposing Express port
- `pvc.yaml` -- PVC with configurable size and storageClass, conditional on `persistence.enabled`
- `ingress.yaml` -- conditional on `ingress.enabled`, with TLS
- `configmap.yaml` -- all `SPARKLE_*` env vars from values

- [ ] **Step 8: Validate Helm chart**

Run: `helm lint helm/sparklebot/`
Expected: No errors.

Run: `helm template sparklebot helm/sparklebot/`
Expected: Valid K8s manifests rendered.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile helm/
git commit -m "feat: Dockerfile and Helm chart for K8s deployment"
```

---

### Task 13: Integration Testing and Polish

**Files:**
- Modify: various files for fixes found during integration

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Local end-to-end smoke test**

Start the app with real (or test) Slack tokens. Verify:
1. Bot connects via Socket Mode
2. `.sparkle @user reason` records sparkle and batches confirmation
3. `.sparkles` sends DM with leaderboard
4. `.sparkle party` works in a channel
5. Self-sparkle shame works (try twice)
6. Dashboard shows leaderboard, feed, channels, personal history
7. Slack OAuth login works
8. HTMX polling on feed page works
9. Mobile hamburger menu works

- [ ] **Step 3: Fix any issues found**

Address bugs found during smoke testing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration testing fixes and polish"
```

- [ ] **Step 5: Push to remote**

```bash
git push origin main
```
