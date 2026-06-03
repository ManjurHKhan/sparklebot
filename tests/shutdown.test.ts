import { describe, it, expect } from 'vitest';
import { createShutdownHandler } from '../src/shutdown.js';

// Codex finding: SIGTERM used to close the SQLite store immediately, killing the DB
// out from under an in-flight command and skipping the Bolt drain. Shutdown must
// stop the Slack consumer (draining in-flight handlers) BEFORE closing the store.
describe('shutdown handler', () => {
  it('stops the app before closing the store, then exits 0', async () => {
    const order: string[] = [];
    const shutdown = createShutdownHandler({
      app: { stop: async () => { order.push('app.stop'); } },
      store: { close: () => { order.push('store.close'); } },
      log: () => {},
      exit: (code) => { order.push(`exit(${code})`); },
    });
    await shutdown();
    expect(order).toEqual(['app.stop', 'store.close', 'exit(0)']);
  });

  it('still closes the store and exits if app.stop fails', async () => {
    const order: string[] = [];
    const shutdown = createShutdownHandler({
      app: { stop: async () => { throw new Error('ws already dead'); } },
      store: { close: () => { order.push('store.close'); } },
      log: () => {},
      exit: (code) => { order.push(`exit(${code})`); },
    });
    await shutdown();
    expect(order).toEqual(['store.close', 'exit(0)']);
  });

  // Codex finding: app.stop() stops the Socket Mode consumer but is not proven to wait
  // for already-running handlers. Shutdown must track active dispatches itself and only
  // close the store once they hit zero (or a bounded timeout passes).
  it('waits for in-flight dispatches to drain before closing the store', async () => {
    let active = 2;
    let activeAtClose = -1;
    const shutdown = createShutdownHandler({
      app: { stop: async () => {} },
      store: { close: () => { activeAtClose = active; } },
      log: () => {},
      exit: () => {},
      activeCount: () => active,
      drainPollMs: 5,
      drainTimeoutMs: 1000,
    });
    const done = shutdown();
    setTimeout(() => { active = 1; }, 15);
    setTimeout(() => { active = 0; }, 30);
    await done;
    expect(activeAtClose).toBe(0);
  });

  it('closes anyway after the drain timeout if a handler is stuck', async () => {
    let closed = false;
    const shutdown = createShutdownHandler({
      app: { stop: async () => {} },
      store: { close: () => { closed = true; } },
      log: () => {},
      exit: () => {},
      activeCount: () => 1, // never drains
      drainPollMs: 5,
      drainTimeoutMs: 30,
    });
    await shutdown();
    expect(closed).toBe(true);
  });

  it('is idempotent — a second signal does not double-close', async () => {
    let closes = 0;
    const shutdown = createShutdownHandler({
      app: { stop: async () => {} },
      store: { close: () => { closes++; } },
      log: () => {},
      exit: () => {},
    });
    await Promise.all([shutdown(), shutdown()]);
    expect(closes).toBe(1);
  });
});
