/**
 * Formats a batch sparkle confirmation message for Slack.
 *
 * @param {object} opts
 * @param {string} opts.receiverId       - Slack user ID of the receiver
 * @param {Array}  opts.sparkles         - Array of { giverName, reason } objects
 * @param {number} opts.totalCount       - Receiver's new total sparkle count
 * @param {string} opts.encouragement    - Encouragement string
 * @param {string} opts.currency         - Currency label (e.g. "sparkles")
 * @param {string} opts.emoji            - Emoji prefix (e.g. "✨")
 * @returns {string}
 */
export function formatBatchConfirmation({ receiverId, sparkles, totalCount, encouragement, currency, emoji }) {
  const count = sparkles.length;
  const header = `${emoji} <@${receiverId}> just got ${count} ${currency}! (total: ${totalCount})`;

  // Single sparkle with no reason: minimal format
  if (count === 1 && !sparkles[0].reason) {
    return `${header}\n${encouragement}\n\n  ${sparkles[0].giverName}`;
  }

  const withReason = sparkles.filter(s => s.reason);
  const withoutReason = sparkles.filter(s => !s.reason);

  const lines = [];
  for (const s of withReason) {
    lines.push(`  ${s.giverName}: ${s.reason}`);
  }
  if (withoutReason.length > 0) {
    lines.push(`  ${withoutReason.map(s => s.giverName).join(', ')}`);
  }

  return `${header}\n${encouragement}\n\n${lines.join('\n')}`;
}
