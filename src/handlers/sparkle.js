/**
 * Sparkle command handler.
 * Exports parseSparkleCommand and handleSparkle.
 */

/**
 * Parse a .sparkle command from raw message text.
 * Returns null if the text is not a sparkle command.
 * Returns { isParty, targets, reason } otherwise.
 */
export function parseSparkleCommand(text) {
  if (!text) return null;

  // Must start with ".sparkle " (with trailing space) OR be exactly ".sparkle" -- but
  // we need at least one argument, so ".sparkle" alone returns null too.
  // ".sparkles" (with s) is a different command and must return null.
  if (!text.startsWith('.sparkle ')) return null;

  const rest = text.slice('.sparkle '.length).trim();
  if (!rest) return null;

  // Party shortcut
  if (rest === 'party' || rest.startsWith('party ')) {
    return { isParty: true, targets: [] };
  }

  const targets = [];
  let remaining = rest;

  // Greedily consume mention tokens <@UXXXXX> or <@UXXXXX|display> from the front
  const mentionRe = /^<@([A-Z0-9]+)(?:\|[^>]*)?>(\s+|$)/;

  while (remaining.length > 0) {
    const match = remaining.match(mentionRe);
    if (match) {
      targets.push({ id: match[1], raw: `<@${match[1]}>` });
      remaining = remaining.slice(match[0].length);
    } else {
      // No more mentions. If we already have targets the rest is the reason.
      // If we have NO targets, treat the first word as a plain text target.
      if (targets.length === 0) {
        const spaceIdx = remaining.indexOf(' ');
        if (spaceIdx === -1) {
          targets.push({ id: null, raw: remaining });
          remaining = '';
        } else {
          targets.push({ id: null, raw: remaining.slice(0, spaceIdx) });
          remaining = remaining.slice(spaceIdx + 1).trim();
        }
      }
      break;
    }
  }

  const reason = remaining.trim() || null;

  return { isParty: false, targets, reason };
}

/**
 * Handle a .sparkle command event.
 * @param {object} opts
 * @param {object} opts.message  - Slack message object { text, user, channel }
 * @param {object} opts.client   - Slack Web API client
 * @param {object} opts.db       - DB instance from createDb
 * @param {object} opts.batcher  - Batcher instance
 * @param {object} opts.messages - Messages instance from createMessages
 * @param {object} opts.config   - Config object from loadConfig
 */
export async function handleSparkle({ message, client, db, batcher, messages, config }) {
  const parsed = parseSparkleCommand(message.text);
  if (!parsed) return;

  const { user: giverId, channel: channelId } = message;

  if (parsed.isParty) {
    await handleParty({ giverId, channelId, client, db, messages, config });
    return;
  }

  for (const target of parsed.targets) {
    const receiverId = target.id ?? target.raw;
    const receiverName = target.id ?? target.raw;
    const isSelf = target.id === giverId;

    if (isSelf) {
      const { firstTime, attempts } = db.recordSelfSparkle(giverId);
      if (firstTime) {
        // First self-sparkle: allow it, record in DB, add to batcher
        db.insertSparkle({ giverId, receiverId, receiverName, reason: parsed.reason, channelId });
        const isFirstSparkle = false; // can't be first because recordSelfSparkle already inserted self record
        batcher.add({ receiverId, channelId, giverId, giverName: giverId, reason: parsed.reason, isFirstSparkle, receiverName });
      } else {
        // Subsequent self-sparkle: post shame message, do NOT insert
        const shameText = messages.selfSparkleShame({ user: giverId, attempts });
        await client.chat.postMessage({ channel: channelId, text: shameText });
      }
    } else {
      const isFirstSparkle = db.isFirstSparkle(receiverId);
      db.insertSparkle({ giverId, receiverId, receiverName, reason: parsed.reason, channelId });
      batcher.add({ receiverId, channelId, giverId, giverName: giverId, reason: parsed.reason, isFirstSparkle, receiverName });
    }
  }
}

async function handleParty({ giverId, channelId, client, db, messages, config }) {
  const partyOldest = (Date.now() / 1000 - config.partyMinutes * 60).toString();

  const historyResult = await client.conversations.history({
    channel: channelId,
    limit: 100,
    oldest: partyOldest,
  });

  const seenUsers = new Set();
  const partyUsers = [];

  for (const msg of historyResult.messages || []) {
    // Skip bots, skip triggerer, skip duplicates
    if (msg.bot_id) continue;
    if (msg.user === giverId) continue;
    if (!msg.user) continue;
    if (seenUsers.has(msg.user)) continue;
    seenUsers.add(msg.user);
    partyUsers.push(msg.user);
  }

  if (partyUsers.length === 0) {
    await client.chat.postMessage({
      channel: channelId,
      text: `No one to party with! :sob: No one else has posted in the last ${config.partyMinutes} minutes.`,
    });
    return;
  }

  // Insert sparkles for all party recipients
  for (const userId of partyUsers) {
    db.insertSparkle({ giverId, receiverId: userId, receiverName: userId, reason: 'party', channelId });
  }

  // Post single party announcement directly (bypass batcher)
  const partyText = messages.partyAnnouncement({ user: giverId, count: partyUsers.length, channel: channelId });
  await client.chat.postMessage({ channel: channelId, text: partyText });
}
