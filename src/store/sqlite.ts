import Database from 'better-sqlite3';
import type { LeaderboardEntry, SparkleRow, Store } from './store.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sparkles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giver_id TEXT NOT NULL,
    giver_name TEXT,
    receiver_id TEXT NOT NULL,
    receiver_name TEXT,
    reason TEXT,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS self_sparkle_attempts (
    user_id TEXT PRIMARY KEY,
    succeeded INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    last_attempt DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_sparkles_receiver ON sparkles(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_sparkles_channel ON sparkles(channel_id);
  CREATE INDEX IF NOT EXISTS idx_sparkles_created ON sparkles(created_at);
  CREATE INDEX IF NOT EXISTS idx_sparkles_giver ON sparkles(giver_id);
`;

export function createSqliteStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  // synchronous stays at the FULL default: max durability, and commit latency is
  // irrelevant at this write volume. Revisit (NORMAL is WAL-safe) only if it ever matters.
  db.exec(SCHEMA);

  // Migration guard for DBs created before these columns existed (ported from legacy migrate()).
  const cols = (db.prepare('PRAGMA table_info(sparkles)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes('giver_name')) db.exec('ALTER TABLE sparkles ADD COLUMN giver_name TEXT');
  if (!cols.includes('channel_name')) db.exec('ALTER TABLE sparkles ADD COLUMN channel_name TEXT');

  const insertStmt = db.prepare(`
    INSERT INTO sparkles (giver_id, giver_name, receiver_id, receiver_name, reason, channel_id, channel_name)
    VALUES (@giverId, @giverName, @receiverId, @receiverName, @reason, @channelId, @channelName)
  `);
  const insertMany = db.transaction((rows: SparkleRow[]) => {
    for (const r of rows) insertStmt.run(r);
  });

  // receiver_id tiebreaker keeps board order deterministic when counts tie.
  const leaderboardStmt = db.prepare(`
    SELECT receiver_id, receiver_name, COUNT(*) as count
    FROM sparkles GROUP BY receiver_id ORDER BY count DESC, receiver_id ASC LIMIT ?
  `);
  const rankStmt = db.prepare(`
    WITH ranked AS (
      SELECT receiver_id, COUNT(*) as count,
             RANK() OVER (ORDER BY COUNT(*) DESC) as rank
      FROM sparkles GROUP BY receiver_id
    )
    SELECT rank, count FROM ranked WHERE receiver_id = ?
  `);
  const totalReceivedStmt = db.prepare(`SELECT COUNT(*) as count FROM sparkles WHERE receiver_id = ?`);
  const getSelfStmt = db.prepare(`SELECT attempts FROM self_sparkle_attempts WHERE user_id = ?`);
  const insertSelfStmt = db.prepare(`
    INSERT INTO self_sparkle_attempts (user_id, succeeded, attempts, last_attempt)
    VALUES (?, 1, 1, CURRENT_TIMESTAMP)
  `);
  const updateSelfStmt = db.prepare(`
    UPDATE self_sparkle_attempts
    SET attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `);

  return {
    insertSparkles(rows: SparkleRow[]): void {
      insertMany(rows);
    },
    getLeaderboard(limit: number): LeaderboardEntry[] {
      return leaderboardStmt.all(limit) as LeaderboardEntry[];
    },
    getUserRank(userId: string) {
      return rankStmt.get(userId) as { rank: number; count: number } | undefined;
    },
    getTotalReceived(userId: string): number {
      return (totalReceivedStmt.get(userId) as { count: number }).count;
    },
    isFirstSparkle(receiverId: string): boolean {
      return this.getTotalReceived(receiverId) === 0;
    },
    recordSelfSparkle(userId: string) {
      const existing = getSelfStmt.get(userId) as { attempts: number } | undefined;
      if (!existing) {
        insertSelfStmt.run(userId);
        return { firstTime: true, attempts: 1 };
      }
      updateSelfStmt.run(userId);
      return { firstTime: false, attempts: existing.attempts + 1 };
    },
    healthCheck(): boolean {
      try {
        return (db.prepare('SELECT 1 as ok').get() as { ok: number }).ok === 1;
      } catch {
        return false;
      }
    },
    close(): void {
      db.close();
    },
  };
}
