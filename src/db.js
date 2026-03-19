import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sparkles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    giver_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    receiver_name TEXT,
    reason TEXT,
    channel_id TEXT NOT NULL,
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

export function createDb(dbPath) {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const stmts = {
    insertSparkle: db.prepare(`
      INSERT INTO sparkles (giver_id, receiver_id, receiver_name, reason, channel_id)
      VALUES (@giverId, @receiverId, @receiverName, @reason, @channelId)
    `),

    getLeaderboard: db.prepare(`
      SELECT receiver_id, receiver_name, COUNT(*) as count
      FROM sparkles
      GROUP BY receiver_id
      ORDER BY count DESC
      LIMIT ?
    `),

    getUserRank: db.prepare(`
      WITH ranked AS (
        SELECT receiver_id, COUNT(*) as count,
               RANK() OVER (ORDER BY COUNT(*) DESC) as rank
        FROM sparkles
        GROUP BY receiver_id
      )
      SELECT rank, count FROM ranked WHERE receiver_id = ?
    `),

    getSparklesReceived: db.prepare(`
      SELECT * FROM sparkles WHERE receiver_id = ? ORDER BY created_at DESC LIMIT ?
    `),

    getSparklesGiven: db.prepare(`
      SELECT * FROM sparkles WHERE giver_id = ? ORDER BY created_at DESC LIMIT ?
    `),

    getTotalReceived: db.prepare(`
      SELECT COUNT(*) as count FROM sparkles WHERE receiver_id = ?
    `),

    getTotalGiven: db.prepare(`
      SELECT COUNT(*) as count FROM sparkles WHERE giver_id = ?
    `),

    isFirstSparkle: db.prepare(`
      SELECT COUNT(*) as count FROM sparkles WHERE receiver_id = ?
    `),

    getChannelStats: db.prepare(`
      SELECT channel_id, COUNT(*) as count
      FROM sparkles
      GROUP BY channel_id
      ORDER BY count DESC
    `),

    getRecentActivity: db.prepare(`
      SELECT * FROM sparkles ORDER BY created_at DESC LIMIT ?
    `),

    getSelfSparkle: db.prepare(`
      SELECT * FROM self_sparkle_attempts WHERE user_id = ?
    `),

    insertSelfSparkle: db.prepare(`
      INSERT INTO self_sparkle_attempts (user_id, succeeded, attempts, last_attempt)
      VALUES (?, 1, 1, CURRENT_TIMESTAMP)
    `),

    updateSelfSparkle: db.prepare(`
      UPDATE self_sparkle_attempts
      SET attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `),
  };

  return {
    insertSparkle({ giverId, receiverId, receiverName = null, reason = null, channelId }) {
      stmts.insertSparkle.run({ giverId, receiverId, receiverName, reason, channelId });
    },

    getLeaderboard(limit) {
      return stmts.getLeaderboard.all(limit);
    },

    getUserRank(userId) {
      return stmts.getUserRank.get(userId);
    },

    getSparklesReceived(userId, limit) {
      return stmts.getSparklesReceived.all(userId, limit);
    },

    getSparklesGiven(userId, limit) {
      return stmts.getSparklesGiven.all(userId, limit);
    },

    getTotalReceived(userId) {
      return stmts.getTotalReceived.get(userId).count;
    },

    getTotalGiven(userId) {
      return stmts.getTotalGiven.get(userId).count;
    },

    isFirstSparkle(receiverId) {
      return stmts.isFirstSparkle.get(receiverId).count === 0;
    },

    getChannelStats() {
      return stmts.getChannelStats.all();
    },

    getRecentActivity(limit) {
      return stmts.getRecentActivity.all(limit);
    },

    recordSelfSparkle(userId) {
      const existing = stmts.getSelfSparkle.get(userId);
      if (!existing) {
        stmts.insertSelfSparkle.run(userId);
        return { firstTime: true, attempts: 1 };
      }
      stmts.updateSelfSparkle.run(userId);
      return { firstTime: false, attempts: existing.attempts + 1 };
    },

    close() {
      db.close();
    },
  };
}
