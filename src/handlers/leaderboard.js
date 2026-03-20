export function formatLeaderboard(board, userRank, config) {
  const title = config.currencyPlural.charAt(0).toUpperCase() + config.currencyPlural.slice(1);
  const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

  const lines = [`All-Time ${title} Leaderboard`, ''];

  board.forEach((entry, i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`;
    const currency = entry.count === 1 ? config.currency : config.currencyPlural;
    lines.push(`${prefix}. ${entry.receiver_name} - *${entry.count}* ${currency}`);
  });

  const inBoard = board.some((e) => e.receiver_id === userRank.userId);
  if (!inBoard && userRank.rank) {
    const currency = userRank.count === 1 ? config.currency : config.currencyPlural;
    lines.push('');
    lines.push(`You're ranked #${userRank.rank} with *${userRank.count}* ${currency}.`);
  }

  return lines.join('\n');
}

export async function handleLeaderboard({ message, client, db, config }) {
  const board = await db.getLeaderboard(10);
  const rankData = await db.getUserRank(message.user);
  const userRank = rankData
    ? { userId: message.user, rank: rankData.rank, count: rankData.count }
    : { userId: message.user, rank: null, count: 0 };

  const formatted = formatLeaderboard(board, userRank, config);

  const dm = await client.conversations.open({ users: message.user });
  await client.chat.postMessage({ channel: dm.channel.id, text: formatted });
}
