export interface ShutdownDeps {
  /** Bolt App (or anything with an async stop) — stops the Socket Mode consumer. */
  app: { stop(): Promise<unknown> };
  store: { close(): void };
  log: (...args: unknown[]) => void;
  exit: (code: number) => void;
  /**
   * Live count of in-flight dispatches. app.stop() stops NEW deliveries but is not
   * proven to wait for running handlers, so we drain explicitly before closing the store.
   */
  activeCount?: () => number;
  drainPollMs?: number;
  drainTimeoutMs?: number;
}

/**
 * Graceful shutdown: stop the Slack consumer first (no new messages, in-flight
 * handlers drain), close the store second, then exit. Closing the store before the
 * drain would kill the DB out from under a command that already claimed a message.
 */
export function createShutdownHandler(deps: ShutdownDeps): () => Promise<void> {
  const { app, store, log, exit, activeCount, drainPollMs = 50, drainTimeoutMs = 5_000 } = deps;
  let shuttingDown = false;
  return async function shutdown(): Promise<void> {
    if (shuttingDown) return; // second signal — first run owns the teardown
    shuttingDown = true;
    log('shutting down: stopping Slack consumer...');
    try {
      await app.stop();
    } catch (err) {
      log('app.stop failed (continuing shutdown)', err);
    }
    if (activeCount) {
      const deadline = Date.now() + drainTimeoutMs;
      while (activeCount() > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, drainPollMs));
      }
      const left = activeCount();
      if (left > 0) log(`drain timeout: ${left} dispatch(es) still in flight, closing anyway`);
    }
    store.close();
    log('store closed, exiting.');
    exit(0);
  };
}
