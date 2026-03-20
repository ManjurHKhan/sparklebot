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

    it('stores giver_name and channel_name', () => {
      db.insertSparkle({ giverId: 'U1', giverName: 'Alice', receiverId: 'U2', receiverName: 'bob', channelId: 'C1', channelName: 'general' });
      const sparkles = db.getSparklesReceived('U2', 10);
      expect(sparkles[0].giver_name).toBe('Alice');
      expect(sparkles[0].channel_name).toBe('general');
    });

    it('handles null giver_name and channel_name gracefully', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      const sparkles = db.getSparklesReceived('U2', 10);
      expect(sparkles[0].giver_name).toBe(null);
      expect(sparkles[0].channel_name).toBe(null);
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

    it('leaderboard respects limit', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'a', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'b', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U4', receiverName: 'c', channelId: 'C1' });
      const board = db.getLeaderboard(2);
      expect(board).toHaveLength(2);
    });

    it('returns user rank and count', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'carol', channelId: 'C1' });
      const rank = db.getUserRank('U3');
      expect(rank.rank).toBe(2);
      expect(rank.count).toBe(1);
    });

    it('returns null for unranked user', () => {
      const rank = db.getUserRank('U999');
      expect(rank).toBeUndefined();
    });

    it('returns channel stats sorted by count', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      db.insertSparkle({ giverId: 'U1', receiverId: 'U3', receiverName: 'carol', channelId: 'C2' });
      const stats = db.getChannelStats();
      expect(stats[0].channel_id).toBe('C1');
      expect(stats[0].count).toBe(2);
    });

    it('channel stats include channel_name', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1', channelName: 'general' });
      const stats = db.getChannelStats();
      expect(stats[0].channel_name).toBe('general');
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

    it('returns 0 for user with no sparkles received', () => {
      expect(db.getTotalReceived('U999')).toBe(0);
    });

    it('returns total given count for a user', () => {
      db.insertSparkle({ giverId: 'U1', receiverId: 'U2', receiverName: 'bob', channelId: 'C1' });
      expect(db.getTotalGiven('U1')).toBe(1);
    });

    it('returns 0 for user with no sparkles given', () => {
      expect(db.getTotalGiven('U999')).toBe(0);
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

    it('returns empty arrays for empty DB', () => {
      expect(db.getLeaderboard(10)).toEqual([]);
      expect(db.getChannelStats()).toEqual([]);
      expect(db.getRecentActivity(50)).toEqual([]);
      expect(db.getSparklesReceived('U1', 10)).toEqual([]);
      expect(db.getSparklesGiven('U1', 10)).toEqual([]);
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

    it('tracks attempts independently per user', () => {
      db.recordSelfSparkle('U1');
      db.recordSelfSparkle('U1');
      const result1 = db.recordSelfSparkle('U1');
      const result2 = db.recordSelfSparkle('U2');
      expect(result1.attempts).toBe(3);
      expect(result2.firstTime).toBe(true);
      expect(result2.attempts).toBe(1);
    });
  });
});
