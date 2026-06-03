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
  /** SELECT 1 — used by the health probe. */
  healthCheck(): boolean;
  close(): void;
}
