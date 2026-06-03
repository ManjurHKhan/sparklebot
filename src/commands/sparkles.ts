import { fmt, joinSafe, trusted, type SafeText } from '../framework/safe.js';
import { AccessLevel, type Command, type Context } from '../framework/types.js';

export interface SparklesConfig {
  currency: string;
  currencyPlural: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function createSparklesCommand(config: SparklesConfig, boardSize = 10): Command {
  return {
    name: () => 'sparkles',
    aliases: () => [],
    help: () => '`.sparkles` — all-time leaderboard (via DM)',
    access: () => AccessLevel.Everyone,
    takesTargets: () => false,
    subcommands: () => [],

    async run(ctx: Context): Promise<void> {
      const board = ctx.store.getLeaderboard(boardSize);
      const title = config.currencyPlural.charAt(0).toUpperCase() + config.currencyPlural.slice(1);

      const lines: SafeText[] = [trusted(`All-Time ${title} Leaderboard`), trusted('')];
      board.forEach((entry, i) => {
        const prefix = i < 3 ? MEDALS[i]! : `${i + 1}.`;
        const currency = entry.count === 1 ? config.currency : config.currencyPlural;
        lines.push(fmt`${trusted(prefix)} ${entry.receiver_name ?? entry.receiver_id} - *${entry.count}* ${trusted(currency)}`);
      });

      const onBoard = board.some((e) => e.receiver_id === ctx.giver.id);
      if (!onBoard) {
        const rank = ctx.store.getUserRank(ctx.giver.id);
        if (rank) {
          const currency = rank.count === 1 ? config.currency : config.currencyPlural;
          lines.push(trusted(''));
          lines.push(fmt`You're ranked #${rank.rank} with *${rank.count}* ${trusted(currency)}.`);
        }
      }

      await ctx.replyDM(joinSafe(lines, '\n'));
    },
  };
}
