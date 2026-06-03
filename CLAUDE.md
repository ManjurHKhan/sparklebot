# sparklebot — agent instructions

Slack peer-recognition bot built as a TypeScript dot-command framework. Bolt Socket Mode, single replica, SQLite on a PVC.

## Architecture (read before changing anything)

Slack message → `src/framework/dispatcher.ts` (token parse → human-giver gate → target resolution → caps → rate limit) → `Command.run(ctx)` → `ctx.reply()` (escaping enforced at this boundary).

- Commands live in `src/commands/`, one file each, registered in `src/index.ts`.
- Plugins only touch `Context` (`src/framework/types.ts`). No raw Slack client, no direct posting.
- All user-derived output goes through `fmt`/`escapeText` (`src/framework/safe.ts`). `trusted()` is for repo-authored string literals ONLY — never variables holding user input. `SafeText` has no public constructor; the reply boundary rejects non-instances at runtime.
- Storage via the `Store` interface (`src/store/store.ts`); SQLite impl in `src/store/sqlite.ts`. Single connection, WAL, transactions for multi-row writes.

## Adding / removing a command

Follow `docs/extending.md` exactly. Short version: new file in `src/commands/` implementing `Command`, one `registry.register()` line in `src/index.ts`, test file using `tests/helpers/ctx.ts`. Remove = delete those three touchpoints.

## Non-negotiable rules

- `tests/exploits.test.ts` is the security contract. Never weaken an assertion to make a change pass — fix the change.
- Public repo: no real Slack tokens, workspace IDs, or user IDs anywhere (tests use `U0FAKE…`/`C0FAKE…`).
- Middleware security controls (giver gate, target resolution, escaping, rate limits, caps) live in the framework, never per-command.
- TypeScript strict; `npm run typecheck && npm test` must pass before any commit.
