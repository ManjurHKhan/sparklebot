import { describe, it, expect, afterEach } from 'vitest';
import { createHealthServer } from '../src/health.js';
import type { Server } from 'node:http';

let server: Server;
afterEach(() => server?.close());

/** listen(0) is async — address() is null until the 'listening' event fires. */
async function listeningPort(s: Server): Promise<number> {
  if (!s.address()) await new Promise<void>((r) => s.once('listening', () => r()));
  return (s.address() as { port: number }).port;
}

async function get(port: number, path: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.status;
}

describe('health server', () => {
  it('200 when WS connected and DB healthy', async () => {
    server = createHealthServer({ ws: () => true, db: () => true }, 0);
    const port = await listeningPort(server);
    expect(await get(port, '/healthz')).toBe(200);
  });

  it('503 when WS down or DB unhealthy', async () => {
    server = createHealthServer({ ws: () => false, db: () => true }, 0);
    const port = await listeningPort(server);
    expect(await get(port, '/healthz')).toBe(503);
  });

  it('404 elsewhere', async () => {
    server = createHealthServer({ ws: () => true, db: () => true }, 0);
    const port = await listeningPort(server);
    expect(await get(port, '/nope')).toBe(404);
  });
});
