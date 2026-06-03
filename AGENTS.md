# Agent instructions

See `CLAUDE.md` for architecture and rules — they apply to every coding agent, not just Claude. Key points:

- Extend via the plugin contract in `docs/extending.md`: one command file + one `register()` line + one test file.
- Never bypass `Context` for Slack I/O; never construct `SafeText` manually; never weaken `tests/exploits.test.ts`.
- No real Slack IDs/tokens in code or tests. `npm run typecheck && npm test` green before committing.
