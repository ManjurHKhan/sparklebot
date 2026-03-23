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

// Cache display names and channel names to avoid repeated API calls
const nameCache = new Map();
const channelCache = new Map();

async function getDisplayName(client, userId) {
  if (nameCache.has(userId)) return nameCache.get(userId);
  try {
    const result = await client.users.info({ user: userId });
    const name = result.user.profile.display_name || result.user.real_name || result.user.name;
    nameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

async function getChannelName(client, channelId) {
  if (channelCache.has(channelId)) return channelCache.get(channelId);
  try {
    const result = await client.conversations.info({ channel: channelId });
    const name = result.channel.name;
    channelCache.set(channelId, name);
    return name;
  } catch {
    return channelId;
  }
}

/**
 * Handle a .sparkle command event.
 */
export async function handleSparkle({ message, client, db, messages, config }) {
  const parsed = parseSparkleCommand(message.text);
  if (!parsed) return;

  const { user: giverId, channel: channelId } = message;

  if (parsed.isParty) {
    await handleParty({ giverId, channelId, client, db, messages, config });
    return;
  }

  const giverName = await getDisplayName(client, giverId);
  const channelName = await getChannelName(client, channelId);

  // Get bot user ID for bot-sparkle detection
  const authResult = await client.auth.test();
  const botUserId = authResult.user_id;

  // Deduplicate targets
  const seen = new Set();
  const uniqueTargets = parsed.targets.filter(t => {
    const id = t.id ?? t.raw;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const target of uniqueTargets) {
    const receiverId = target.id ?? target.raw;
    const receiverName = target.id ? await getDisplayName(client, target.id) : target.raw;
    const isBot = target.id === botUserId;
    const isSelf = target.id === giverId;

    if (isBot) {
      const quip = messages.botSparkleQuip({ giver: `*${giverName}*`, user: `*${receiverName}*`, currency: config.currency });
      await client.chat.postMessage({ channel: channelId, text: quip });
    } else if (isSelf) {
      const { firstTime, attempts } = db.recordSelfSparkle(giverId);
      if (firstTime) {
        db.insertSparkle({ giverId, giverName, receiverId, receiverName, reason: parsed.reason, channelId, channelName });
        const totalCount = db.getTotalReceived(receiverId);
        const text = formatSparkle({ giverName, receiverName, reason: parsed.reason, totalCount, config });
        await client.chat.postMessage({ channel: channelId, text });
      } else {
        const shameText = messages.selfSparkleShame({ user: `*${giverName}*`, attempts });
        await client.chat.postMessage({ channel: channelId, text: shameText });
      }
    } else {
      const isFirstSparkle = db.isFirstSparkle(receiverId);
      db.insertSparkle({ giverId, giverName, receiverId, receiverName, reason: parsed.reason, channelId, channelName });
      const totalCount = db.getTotalReceived(receiverId);

      let text;
      if (isFirstSparkle) {
        const emoji = tierEmoji(totalCount);
        const currency = totalCount === 1 ? config.currency : config.currencyPlural;
        const normalizedReason = parsed.reason ? parsed.reason.replace(/^for\s+/i, '').trim() : '';
        const reasonPart = normalizedReason ? ` for _${normalizedReason}_` : '';
        text = messages.firstSparkleCelebration({
          giver: `*${giverName}*`,
          user: `*${receiverName}*`,
          currency: config.currency,
          emoji,
          count: totalCount,
          currencyPlural: currency,
          reason: reasonPart,
        });
      } else {
        text = formatSparkle({ giverName, receiverName, reason: parsed.reason, totalCount, config });
      }
      await client.chat.postMessage({ channel: channelId, text });
    }
  }
}

export function tierEmoji(count) {
  if (count >= 100) return ':gem:';         // 100+ diamond
  if (count >= 50)  return ':star2:';        // 50+ glowing star
  if (count >= 25)  return ':dizzy:';        // 25+ dizzy star
  if (count >= 10)  return ':sparkle:';      // 10+ sparkle
  if (count >= 5)   return ':star:';         // 5+ star
  return ':sparkles:';                       // default sparkles
}

function formatSparkle({ giverName, receiverName, reason, totalCount, config }) {
  const currency = totalCount === 1 ? config.currency : config.currencyPlural;
  const normalizedReason = reason ? reason.replace(/^for\s+/i, '').trim() : '';
  const reasonPart = normalizedReason ? ` for _${normalizedReason}_` : '';
  const emoji = tierEmoji(totalCount);
  return `${emoji} *${giverName}* gave a ${config.currency} to *${receiverName}*${reasonPart}. *${receiverName}* now has *${totalCount}* ${currency}. ${emoji}`;
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
      text: `No one to party with! No one else has posted in the last ${config.partyMinutes} minutes.`,
    });
    return;
  }

  const giverName = await getDisplayName(client, giverId);
  const channelName = await getChannelName(client, channelId);
  const recipientLines = [];
  for (const userId of partyUsers) {
    const receiverName = await getDisplayName(client, userId);
    db.insertSparkle({ giverId, giverName, receiverId: userId, receiverName, reason: 'party', channelId, channelName });
    const totalCount = db.getTotalReceived(userId);
    const emoji = tierEmoji(totalCount);
    recipientLines.push(`${emoji} *${receiverName}* now has *${totalCount}* ✨`);
  }

  const recipients = recipientLines.join('\n> ');
  const people = partyUsers.length === 1 ? 'person' : 'people';
  const partyText = messages.partyAnnouncement({ user: `*${giverName}*`, count: partyUsers.length, channel: `<#${channelId}>`, currency: config.currency, recipients, people });
  await client.chat.postMessage({ channel: channelId, text: partyText });
}
