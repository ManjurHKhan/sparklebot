export interface SparkleRow {
  giverId: string;
  giverName: string | null;
  receiverId: string;
  receiverName: string | null;
  reason: string | null;
  channelId: string;
  channelName: string | null;
}

export interface LeaderboardEntry {
  receiver_id: string;
  receiver_name: string | null;
  count: number;
}

export interface Store {
  /** Insert one or more sparkles atomically (single transaction). */
  insertSparkles(rows: SparkleRow[]): void;
  getLeaderboard(limit: number): LeaderboardEntry[];
  getUserRank(userId: string): { rank: number; count: number } | undefined;
  getTotalReceived(userId: string): number;
  isFirstSparkle(receiverId: string): boolean;
  recordSelfSparkle(userId: string): { firstTime: boolean; attempts: number };
  /**
   * Idempotency claim for an incoming Slack message (channel + ts uniquely identify it).
   * Returns true if this call claimed the message, false if it was already processed —
   * guards against Bolt redelivery (slow ack, Socket Mode reconnect replay).
   */
  markProcessed(channelId: string, ts: string): boolean;
  /**
   * Welcome claim plus the welcome sparkle, in one transaction (guards team_join redelivery).
   * True only the first time for row.receiverId; a failed insert leaves the user unclaimed.
   */
  claimWelcome(row: SparkleRow): boolean;
  /** True once the user has given a sparkle to someone other than themselves. */
  hasGivenToOthers(userId: string): boolean;
  /** SELECT 1 — used by the health probe. */
  healthCheck(): boolean;
  close(): void;
}
