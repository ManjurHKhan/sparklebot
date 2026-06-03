# Extending Sparklebot

This guide walks through adding a new command to the bot, using a worked `.echo` example. The framework's value proposition: *new command = one file + one register() line + one test file*.

## Adding a Command

### Step 1: Create the command file

Create a new file in `src/commands/<name>.ts` implementing the `Command` interface. Here's a complete `.echo` command that echoes back the caller's arguments:

```typescript
// src/commands/echo.ts
import { fmt, type SafeText } from '../framework/safe.js';
import { AccessLevel, type Command, type Context } from '../framework/types.js';

export function createEchoCommand(): Command {
  return {
    name: () => 'echo',
    aliases: () => [],
    help: () => '`.echo <text>` — Echo back your text (escaped)',
    access: () => AccessLevel.Everyone,
    takesTargets: () => false,
    subcommands: () => [],

    async run(ctx: Context): Promise<void> {
      if (!ctx.args.trim()) {
        await ctx.replyEphemeral(fmt`Usage: .echo <text>`);
        return;
      }

      const echoed = fmt`You said: ${ctx.args}`;
      await ctx.replyEphemeral(echoed);
    },
  };
}
```

This example demonstrates:
- **Output escaping**: User input from `ctx.args` enters the message via the `fmt` template tag, which automatically escapes it. Try `.echo <@click_me>` or `.echo *bold*` — they come back inert.
- **No target resolution**: `takesTargets() => false` means the dispatcher does NOT parse `@mention` tokens; `ctx.args` gets the raw text after the command.
- **Ephemeral reply**: `ctx.replyEphemeral()` sends a message only the caller sees.

### Step 2: Register the command

Open `src/index.ts` and add one line in the registration section (around line 66):

```typescript
const registry = new Registry();
registry.register(createEchoCommand());  // <- Add this line
registry.register(
  createSparkleCommand({
    // ... existing config ...
  }),
);
```

The order doesn't matter. The dispatcher looks up commands by name.

### Step 3: Add a test

Create `tests/echo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createEchoCommand } from '../src/commands/echo.js';
import { makeCtx } from './helpers/ctx.js';

describe('.echo', () => {
  it('echoes back user input with escaping', async () => {
    const h = makeCtx({ args: 'hello world' });
    await createEchoCommand().run(h.ctx);
    expect(h.ephemerals).toHaveLength(1);
    expect(h.ephemerals[0]).toContain('hello world');
  });

  it('escapes dangerous input', async () => {
    const h = makeCtx({ args: '<@click_me> and *bold*' });
    await createEchoCommand().run(h.ctx);
    const text = h.ephemerals[0]!;
    expect(text).not.toContain('<@');     // escaped
    expect(text).toContain('&lt;@');
    expect(text).not.toMatch(/\*bold\*/); // mrkdwn neutralized
  });

  it('requires non-empty input', async () => {
    const h = makeCtx({ args: '   ' });
    await createEchoCommand().run(h.ctx);
    expect(h.ephemerals[0]).toContain('Usage:');
  });

  it('takes no targets', () => {
    expect(createEchoCommand().takesTargets()).toBe(false);
  });
});
```

The `makeCtx()` factory from `tests/helpers/ctx.ts` sets up a full `Context` with mocked reply methods. Assertions inspect the arrays: `replies`, `ephemerals`, `dms`.

### Step 4: Test and commit

```bash
npm test
npm run typecheck
git add src/commands/echo.ts src/index.ts tests/echo.test.ts
git commit -m "feat: add echo command"
```

Done. The framework handles everything else.

## What Every Command Inherits for Free

All commands automatically get:

- **Human-giver gate** — Only humans can run commands; bots and app users are rejected at the middleware layer before your `run()` method is called. See `src/framework/dispatcher.ts` line 91–96.
- **Target resolution + dedup + disposition rejects** — If `takesTargets() => true`, the dispatcher parses `@mention` tokens, validates each via Slack's `users.info` API (confirming live humans), deduplicates, and rejects if any target is a non-human bot (including the sparklebot itself). See `src/framework/dispatcher.ts` line 98–120.
- **Broadcast-tag rejection** — Messages containing `<!here>` or `<!channel>` are rejected before target resolution. See `src/framework/dispatcher.ts` line 76–80.
- **Input caps** — Maximum 10 targets per command; maximum 256 characters in the reason/args. Enforced by `cap256()` and `cap10()` in `src/framework/dispatcher.ts`. Your `run()` method never sees overflow.
- **Rate limiting** — Sliding-window budget (default: 10 sparkles per 60 seconds) per giver, enforced via `ctx.rate.tryConsume(n)`. Rejection happens before `run()` is called; see `src/framework/dispatcher.ts` line 140–145.
- **Output escaping at the reply boundary** — All output goes through `ctx.reply()`, `ctx.replyEphemeral()`, `ctx.replyDM()`, or `ctx.react()`. These methods accept only `SafeText` instances; passing a plain string is a compile-time error. See `src/framework/types.ts` lines 36–40.
- **`.{cmd} help` handling** — If a user types `.echo help`, the dispatcher intercepts it and posts your command's help text automatically. See `src/framework/dispatcher.ts` line 85–88.

## The Command Interface, Field by Field

Every command must implement `Command` (from `src/framework/types.ts`):

```typescript
interface Command {
  name(): string;              // Returns the canonical name (e.g., "sparkle")
  aliases(): string[];         // Returns alternative names (e.g., ["s", "sparkles"])
  help(): string;              // One-liner for `.help` and `.cmd help`
  access(): AccessLevel;       // Everyone | Restricted
  takesTargets(): boolean;     // Does this command parse @mention tokens?
  subcommands(): string[];     // Special keywords that bypass target resolution
  run(ctx: Context): Promise<void>;  // The actual command logic
}
```

### `name(): string`

The canonical command name. When a user types `.sparkle`, this is what matches. Returned value is lowercased by the dispatcher (case-insensitive lookup). Usually one word.

### `aliases(): string[]`

Alternative names for the same command. If you return `["s"]`, then `.s` and `.sparkle` both work. Useful for short forms or backward compatibility.

### `help(): string`

A one-liner for display in `.help` and `.cmd help`. Should be short and action-oriented:
- Good: `".echo <text> — Echo back your text (escaped)"`
- Avoid: `"This command echoes things back"` (loses the syntax)

### `access(): AccessLevel`

One of:
- `AccessLevel.Everyone` — Any human can run this command.
- `AccessLevel.Restricted` — Only certain users can run it (implement your own gate inside `run()` with `ctx.giver.id`). The framework doesn't enforce restriction; your code does.

### `takesTargets(): boolean`

**Return `true`** if your command expects `@mention` tokens in the message. The dispatcher will:
1. Parse all tokens like `<@U0FAKE0001>` from the message
2. Validate each via `resolver.resolveUser()`
3. Reject non-humans, dedup, enforce 10-target cap
4. Populate `ctx.mentions` (confirmed live humans)
5. Strip mention tokens from `ctx.args`

**Return `false`** if your command doesn't use mentions. `ctx.mentions` will be empty; `ctx.args` is the full remaining text. The `.echo` command above returns `false`.

### `subcommands(): string[]`

Declare special keywords that bypass target resolution. For example, `.sparkle party` has `subcommands() => ['party']`. When a user types `.sparkle party [reason]`:
1. The dispatcher checks if the first word is in the subcommands list
2. If it matches, target resolution is SKIPPED
3. `ctx.mentions` is empty; `ctx.args` is `[reason]` (party token is removed)
4. Your `run()` method must handle the subcommand itself

This is useful for mode-switching commands where the first token is a verb, not a target.

### `run(ctx: Context): Promise<void>`

Your command's logic. You receive a fully-populated `Context` with:
- Resolved, deduplicated targets in `ctx.mentions` (if `takesTargets() => true`)
- Escaped, capped `ctx.args`
- Rate-limit token in `ctx.rate`
- Database access via `ctx.store`
- Everything you need to operate

## The Context Surface

Every `run()` method receives a `Context` (from `src/framework/types.ts`):

```typescript
interface Context {
  command: string;                          // e.g., "sparkle"
  args: string;                             // Remaining text, escaped
  mentions: User[];                         // Resolved targets (dedup, live humans only)
  giver: User;                              // Human who issued the command
  channel: { id: string; name: string };   // Channel metadata
  botUserId: string;                        // Your bot's user ID
  reply(msg: SafeText): Promise<void>;      // Public reply
  replyEphemeral(msg: SafeText): Promise<void>; // Ephemeral (caller-only)
  replyDM(msg: SafeText): Promise<void>;    // DM, fallback to ephemeral
  react(emoji: string): Promise<void>;      // Emoji reaction on the command message
  rate: { tryConsume(n: number): boolean }; // Sliding-window rate-limit check
  store: Store;                             // Database access
  resolver: ResolverApi;                    // User/channel resolution (read-only)
  log(...args: unknown[]): void;            // Debug logging
}
```

### Output Methods

All output goes through these four methods:

- **`reply(msg: SafeText)`** — Posts a message to the channel, visible to everyone.
- **`replyEphemeral(msg: SafeText)`** — Ephemeral message, visible only to the caller.
- **`replyDM(msg: SafeText)`** — Sends a DM to the caller. If DM fails (e.g., user has DMs closed), falls back to ephemeral channel reply.
- **`react(emoji: string)`** — Adds an emoji reaction to the command message.

**Important:** These methods accept **only** `SafeText` instances. Passing a plain `string` is a compile-time type error. All user-derived text must enter via `fmt()` interpolation or `escapeText()` (for text-only paths).

### Rate Limiting

`ctx.rate.tryConsume(n: number): boolean`

Checks if the giver has budget for `n` sparkles. Returns `true` if the budget was available and charged; `false` if rate-limited. It's a sliding-window counter, per giver, with a default budget of 10 sparkles per 60 seconds. Your code decides how many sparkles to charge; `.sparkle` charges 1 per target, `.sparkle party @a @b @c` charges 3.

**Pattern:**
```typescript
if (!ctx.rate.tryConsume(ctx.mentions.length)) {
  await ctx.replyEphemeral(fmt`Rate limited. Try again in a moment.`);
  return;
}
// Proceed with the command
```

Rate-limit rejection happens at the dispatcher level before your `run()` is called, but you can also enforce stricter limits inside your command.

### Storage

Access the database via `ctx.store: Store`. The `Store` interface is defined in `src/store/store.ts`:

```typescript
interface Store {
  insertSparkles(rows: SparkleRow[]): void;
  getLeaderboard(limit: number): LeaderboardEntry[];
  getUserRank(userId: string): { rank: number; count: number } | undefined;
  getTotalReceived(userId: string): number;
  isFirstSparkle(receiverId: string): boolean;
  recordSelfSparkle(userId: string): { firstTime: boolean; attempts: number };
  healthCheck(): boolean;
  close(): void;
}
```

If you need custom tables, extend the `Store` interface and add DDL + methods to `src/store/sqlite.ts`:

```typescript
// In store.ts (interface):
export interface Store {
  // ... existing methods ...
  myCustomQuery(userId: string): CustomResult[];
}

// In sqlite.ts (implementation):
export function createSqliteStore(dbPath: string): Store {
  // In the constructor, after the existing CREATE TABLE statements:
  db.exec(`CREATE TABLE IF NOT EXISTS my_table (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    data TEXT,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch('now'))
  )`);

  return {
    // ... existing methods ...
    myCustomQuery(userId: string): CustomResult[] {
      return db.prepare(`SELECT * FROM my_table WHERE userId = ?`).all(userId) as CustomResult[];
    },
  };
}
```

**Convention:** Each command owns its tables. Prefix table names with your command name (e.g., `echo_history`, `echo_cache`). Never touch another command's tables.

There is exactly one SQLite connection. All queries go through it; multiple connections are not supported.

### The Resolver (Read-Only)

`ctx.resolver: ResolverApi` provides user and channel metadata:

```typescript
interface ResolverApi {
  resolveUser(id: string): Promise<User | null>;
  channelName(id: string): Promise<string>;
  recentHumanUserIds(channelId: string, sinceMinutes: number, excludeUserId: string): Promise<string[]>;
}
```

**Important:** This is read-only. It cannot post or modify anything. Use it to look up user/channel names for display, or to find recent posters (for party mode).

## Removing a Command

1. Delete the command file: `rm src/commands/<name>.ts`
2. Delete the test file: `rm tests/<name>.test.ts`
3. Remove the `registry.register()` line from `src/index.ts`
4. Run `npm test` to confirm

Database rows are append-only history; removing a command doesn't delete historical sparkles.

## Storage Details

The `Store` interface provides transactional, append-only database access. The SQLite implementation uses WAL mode and enforces consistency.

### Adding Custom Tables

If your command needs to track state beyond the sparkle ledger:

1. Extend `Store` in `src/store/store.ts` with your new methods.
2. Add `CREATE TABLE IF NOT EXISTS` DDL in `src/store/sqlite.ts`, in the initialization block.
3. Implement your query methods using `db.prepare()` (synchronized, no async).

**Example:**
```typescript
// In store.ts, extend the interface:
export interface Store {
  // ... existing ...
  getEchoHistory(userId: string, limit: number): EchoRecord[];
}

// In sqlite.ts, add to the Store implementation:
interface EchoRecord {
  id: string;
  text: string;
  createdAt: number;
}

export function createSqliteStore(dbPath: string): Store {
  // After existing CREATE TABLE calls:
  db.exec(`CREATE TABLE IF NOT EXISTS echo_history (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch('now'))
  )`);

  return {
    // ... existing methods ...
    getEchoHistory(userId: string, limit: number): EchoRecord[] {
      return db.prepare(`
        SELECT id, text, createdAt FROM echo_history
        WHERE userId = ? ORDER BY createdAt DESC LIMIT ?
      `).all(userId, limit) as EchoRecord[];
    },
  };
}
```

Use table-per-command naming. Never open a second SQLite connection. All I/O is single-threaded.

## Hard Rules

These rules are enforced by the framework and test suite:

1. **`SafeText` has no public constructor.** You cannot write `new SafeText(...)`. The only valid constructors are:
   - `fmt`\`...\` (template tag; literals trusted, interpolated values escaped)
   - `trusted(s)` (for framework-authored string literals ONLY — never variables holding user input)
   - `joinSafe(parts, sep)` (joins an array of `SafeText`)

2. **`trusted()` takes string literals ONLY.** This is enforced by code review, not TypeScript:
   ```typescript
   // OK: literal
   await ctx.reply(trusted('All-time leaderboard:'));

   // WRONG: variable (user data, config, etc.)
   const title = ctx.giver.name;
   await ctx.reply(trusted(title));  // WRONG — use fmt instead
   await ctx.reply(fmt`${title}`);   // OK — interpolation escapes title
   ```

3. **The reply boundary throws on non-`SafeText`.** If you try to pass a plain string to `ctx.reply()`, it's a compile-time type error. The runtime also validates at the reply boundary in `src/framework/dispatcher.ts`.

4. **Never import `@slack/web-api` or touch a raw Slack client from a command.** All Slack I/O goes through `Context` methods. This ensures the output boundary is enforced.

5. **Never post outside of `Context`.** Don't hold a reference to the Slack client or app. Everything flows through `ctx.reply()` and friends.

6. **No real Slack IDs in tests.** Use fake IDs: `U0FAKE...` for users, `C0FAKE...` for channels, `B0FAKE...` for bots. This protects the public repo from leaking workspace/user data if tests are accidentally run against a live workspace.

7. **Never weaken `tests/exploits.test.ts`.** This file is the security contract. It tests for injection, escaping, rate-limit bypass, target-resolution bypass, human-giver gate, and more. If a change breaks an exploit-regression test, fix the change — don't weaken the assertion.

## Roadmap Surface Notes

The framework has hooks for future services. Don't build them ad hoc in your command; they'll be added to `Context`:

- **Scheduler** — Scheduled messages / recurring tasks. Will be a service on `Context` (e.g., `ctx.scheduler.schedule(...)`).
- **KV store** — Key-value storage for command state. Will extend `Store` as a KV interface.
- **Authorizer** — Role-based access control beyond `AccessLevel.Restricted`. Will be a service on `Context`.

When these land, they'll slot into the framework. Your command code won't need to change; just use the new service methods.

## Summary

To add a command:

1. Create `src/commands/<name>.ts` implementing `Command`.
2. Call `registry.register(createMyCommand())` in `src/index.ts`.
3. Create `tests/<name>.test.ts` using `makeCtx()`.
4. Run `npm test && npm run typecheck`.

The framework handles security, escaping, rate limiting, and target resolution. Your code focuses on the command's specific logic. See the `.echo` example above for a complete, minimal working command.
