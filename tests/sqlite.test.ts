import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../src/store/sqlite.js';
import type { Store, SparkleRow } from '../src/store/store.js';

function row(over: Partial<SparkleRow> = {}): SparkleRow {
  return {
    giverId: 'U0FAKE0001', giverName: 'alice',
    receiverId: 'U0FAKE0002', receiverName: 'bob',
    reason: 'helping', channelId: 'C0FAKE0001', channelName: 'general',
    ...over,
  };
}

describe('sqlite store', () => {
  let store: Store;
  beforeEach(() => { store = createSqliteStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('inserts and counts sparkles', () => {
    store.insertSparkles([row()]);
    expect(store.getTotalReceived('U0FAKE0002')).toBe(1);
    expect(store.isFirstSparkle('U0FAKE0002')).toBe(false);
    expect(store.isFirstSparkle('U0FAKE0099')).toBe(true);
  });

  it('multi-row insert is atomic', () => {
    store.insertSparkles([row(), row({ receiverId: 'U0FAKE0003' })]);
    expect(store.getTotalReceived('U0FAKE0002')).toBe(1);
    expect(store.getTotalReceived('U0FAKE0003')).toBe(1);
  });

  it('leaderboard orders by count desc', () => {
    store.insertSparkles([row(), row(), row({ receiverId: 'U0FAKE0003' })]);
    const board = store.getLeaderboard(10);
    expect(board[0]).toMatchObject({ receiver_id: 'U0FAKE0002', count: 2 });
    expect(board[1]).toMatchObject({ receiver_id: 'U0FAKE0003', count: 1 });
  });

  it('ranks a user', () => {
    store.insertSparkles([row(), row(), row({ receiverId: 'U0FAKE0003' })]);
    expect(store.getUserRank('U0FAKE0003')).toEqual({ rank: 2, count: 1 });
    expect(store.getUserRank('U0FAKE0099')).toBeUndefined();
  });

  it('tracks self-sparkle attempts', () => {
    expect(store.recordSelfSparkle('U0FAKE0001')).toEqual({ firstTime: true, attempts: 1 });
    expect(store.recordSelfSparkle('U0FAKE0001')).toEqual({ firstTime: false, attempts: 2 });
    expect(store.recordSelfSparkle('U0FAKE0001')).toEqual({ firstTime: false, attempts: 3 });
  });

  // Codex finding: Slack/Bolt can redeliver the same message (slow ack, reconnect replay).
  // markProcessed is the idempotency key: first claim wins, duplicates are rejected.
  it('markProcessed claims a message once and rejects duplicates', () => {
    expect(store.markProcessed('C0FAKE0001', '1717400000.000100')).toBe(true);
    expect(store.markProcessed('C0FAKE0001', '1717400000.000100')).toBe(false);
    // Different ts or channel is a different message.
    expect(store.markProcessed('C0FAKE0001', '1717400000.000200')).toBe(true);
    expect(store.markProcessed('C0FAKE0002', '1717400000.000100')).toBe(true);
  });

  it('healthCheck returns true on a live db', () => {
    expect(store.healthCheck()).toBe(true);
  });

  it('adds missing legacy columns on open (pre-2026-03 schema)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkle-'));
    const p = join(dir, 'old.db');
    const raw = new Database(p);
    raw.exec(`CREATE TABLE sparkles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, giver_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL, receiver_name TEXT, reason TEXT,
      channel_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    raw.close();
    const old = createSqliteStore(p);
    old.insertSparkles([row()]); // would throw without the column-add guard
    expect(old.getTotalReceived('U0FAKE0002')).toBe(1);
    old.close();
  });
});
