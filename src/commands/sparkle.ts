import { fmt, joinSafe, trusted, type SafeText } from '../framework/safe.js';
import { AccessLevel, type Command, type Context, type User } from '../framework/types.js';
import type { Cooldown } from '../framework/rate-limit.js';
import type { Messages } from '../messages.js';
import type { SparkleRow } from '../store/store.js';

const SHAME_CHANNEL_CAP = 5;

export interface SparkleConfig {
  currency: string;
  currencyPlural: string;
  partyMinutes: number;
  partyMaxRecipients: number;
}

export interface SparkleDeps {
  messages: Messages;
  config: SparkleConfig;
  partyChannelCooldown: Cooldown; // key `${giverId}:${channelId}`
  partyGiverCooldown: Cooldown;   // key giverId (cross-channel)
  /** Emoji-only "explosion" posted once per run that crosses a milestone. */
  megaBurst: SafeText;
}

export const MEGA_TIERS = [5, 10, 25, 50, 100] as const;

const isMilestone = (total: number) => total === 1 || (MEGA_TIERS as readonly number[]).includes(total);

export function tierEmoji(count: number): string {
  if (count >= 100) return ':gem:';
  if (count >= 50) return ':star2:';
  if (count >= 25) return ':dizzy:';
  if (count >= 10) return ':sparkle:';
  if (count >= 5) return ':star:';
  return ':sparkles:';
}

function normalizeReason(reason: string): string {
  return reason.replace(/^for\b\s*/i, '').trim();
}

function reasonPart(reason: string): SafeText {
  const r = normalizeReason(reason);
  return r ? fmt` for _${r}_` : trusted('');
}

function formatSparkle(giver: User, receiver: User, reason: string, total: number, cfg: SparkleConfig): SafeText {
  const currency = total === 1 ? cfg.currency : cfg.currencyPlural;
  const emoji = tierEmoji(total);
  return fmt`${trusted(emoji)} *${giver.name}* gave a ${trusted(cfg.currency)} to *${receiver.name}*${reasonPart(reason)}. *${receiver.name}* now has *${total}* ${trusted(currency)}. ${trusted(emoji)}`;
}

export function createSparkleCommand(deps: SparkleDeps): Command {
  const { messages, config } = deps;

  /**
   * Insert the award rows (plus the first-give bonus row when earned) and read every total,
   * all synchronously: no await between the bonus check and the insert (so concurrent runs
   * can't both earn the bonus) or between the insert and the reads (so a milestone isn't
   * missed because another command moved a total while this run was posting).
   */
  function recordAwards(ctx: Context, recipients: User[], reason: string | null) {
    if (recipients.length === 0) return { awarded: false, bonusTotal: 0, celebrate: false, totals: new Map<string, number>() };
    const bonus = !ctx.store.hasGivenToOthers(ctx.giver.id);
    const rows: SparkleRow[] = recipients.map((r) => ({
      giverId: ctx.giver.id, giverName: ctx.giver.name,
      receiverId: r.id, receiverName: r.name,
      reason,
      channelId: ctx.channel.id, channelName: ctx.channel.name,
    }));
    if (bonus) {
      rows.push({
        giverId: ctx.botUserId, giverName: 'Sparklebot',
        receiverId: ctx.giver.id, receiverName: ctx.giver.name,
        reason: 'first sparkle given',
        channelId: ctx.channel.id, channelName: ctx.channel.name,
      });
    }
    ctx.store.insertSparkles(rows);
    const totals = new Map(recipients.map((r) => [r.id, ctx.store.getTotalReceived(r.id)]));
    const bonusTotal = bonus ? ctx.store.getTotalReceived(ctx.giver.id) : 0;
    const celebrate = bonus || [...totals.values()].some(isMilestone);
    return { awarded: true, bonusTotal, celebrate, totals };
  }

  /** After the award messages: agent nudge, bonus line (if earned), then at most one explosion. */
  async function finishAwards(ctx: Context, { awarded, bonusTotal, celebrate }: ReturnType<typeof recordAwards>): Promise<void> {
    if (awarded && ctx.viaAgent) await ctx.reply(messages.agentNudge({ user: fmt`*${ctx.giver.name}*` }));
    if (bonusTotal > 0) {
      await ctx.reply(messages.firstGiveBonus({ user: fmt`*${ctx.giver.name}*`, count: bonusTotal, currency: config.currency }));
    }
    if (celebrate) await ctx.reply(deps.megaBurst);
  }

  async function awardHumans(ctx: Context, targets: User[]): Promise<void> {
    const firstFlags = new Map(targets.map((t) => [t.id, ctx.store.isFirstSparkle(t.id)]));
    const rec = recordAwards(ctx, targets, normalizeReason(ctx.args) || null);
    const { totals } = rec;

    for (const t of targets) {
      const total = totals.get(t.id)!;
      if (firstFlags.get(t.id)) {
        const currency = total === 1 ? config.currency : config.currencyPlural;
        await ctx.reply(
          messages.firstSparkleCelebration({
            giver: fmt`*${ctx.giver.name}*`,
            user: fmt`*${t.name}*`,
            currency: config.currency,
            emoji: tierEmoji(total),
            count: total,
            currencyPlural: currency,
            reason: reasonPart(ctx.args),
          }),
        );
      } else {
        await ctx.reply(formatSparkle(ctx.giver, t, ctx.args, total, config));
      }
    }
    await finishAwards(ctx, rec);
  }

  async function runSelf(ctx: Context): Promise<void> {
    const { firstTime, attempts } = ctx.store.recordSelfSparkle(ctx.giver.id);
    if (firstTime) {
      ctx.store.insertSparkles([{
        giverId: ctx.giver.id, giverName: ctx.giver.name,
        receiverId: ctx.giver.id, receiverName: ctx.giver.name,
        reason: normalizeReason(ctx.args) || null,
        channelId: ctx.channel.id, channelName: ctx.channel.name,
      }]);
      const total = ctx.store.getTotalReceived(ctx.giver.id);
      await ctx.reply(formatSparkle(ctx.giver, ctx.giver, ctx.args, total, config));
      return;
    }
    const shame = messages.selfSparkleShame({ user: fmt`*${ctx.giver.name}*`, attempts });
    // Cap channel spam: escalate publicly up to N attempts, then go ephemeral.
    if (attempts <= SHAME_CHANNEL_CAP) await ctx.reply(shame);
    else await ctx.replyEphemeral(shame);
  }

  async function runParty(ctx: Context): Promise<void> {
    // Party takes no targets — a trailing mention means the giver expected a targeted
    // sparkle, not "sparkle whoever posted recently". Reject before any cooldown burns.
    if (/<@[A-Z0-9]+(?:\|[^>]*)?>/.test(ctx.args)) {
      await ctx.replyEphemeral(
        trusted("Party doesn't take targets — it sparkles everyone recently active. Use `.sparkle @user [reason]` for a specific person."),
      );
      return;
    }
    if (!deps.partyChannelCooldown.try(`${ctx.giver.id}:${ctx.channel.id}`)) {
      await ctx.replyEphemeral(trusted('Party cooldown — try this channel again in a few minutes.'));
      return;
    }
    if (!deps.partyGiverCooldown.try(ctx.giver.id)) {
      await ctx.replyEphemeral(trusted('Cross-channel party cooldown — one party spree at a time.'));
      return;
    }

    const activeIds = (
      await ctx.resolver.recentHumanUserIds(ctx.channel.id, config.partyMinutes, ctx.giver.id)
    ).slice(0, config.partyMaxRecipients);

    if (activeIds.length === 0) {
      await ctx.reply(
        fmt`No one to party with! No one else has posted in the last ${config.partyMinutes} minutes.`,
      );
      return;
    }

    if (!ctx.rate.tryConsume(activeIds.length)) {
      await ctx.replyEphemeral(trusted('Rate limit hit — that party would exceed your sparkle budget.'));
      return;
    }

    const recipients: User[] = [];
    for (const id of activeIds) {
      const u = await ctx.resolver.resolveUser(id);
      if (u && !u.isBot) recipients.push(u);
    }

    // After every await above: the check, insert and reads must stay in one synchronous block.
    const rec = recordAwards(ctx, recipients, 'party');
    const { totals } = rec;

    const lines = recipients.map((r) => {
      const total = totals.get(r.id)!;
      return fmt`${trusted(tierEmoji(total))} *${r.name}* now has *${total}* ✨`;
    });
    const people = recipients.length === 1 ? 'person' : 'people';
    const currency = recipients.length === 1 ? config.currency : config.currencyPlural;
    await ctx.reply(
      messages.partyAnnouncement({
        user: fmt`*${ctx.giver.name}*`,
        count: recipients.length,
        channel: trusted(`<#${ctx.channel.id}>`),
        currency,
        recipients: joinSafe(lines, '\n> '),
        people,
      }),
    );
    await finishAwards(ctx, rec);
  }

  return {
    name: () => 'sparkle',
    aliases: () => [],
    help: () =>
      '`.sparkle @user [reason]` — give a sparkle · `.sparkle @a @b [reason]` — multiple · `.sparkle party` — sparkle everyone recently active',
    access: () => AccessLevel.Everyone,
    takesTargets: () => true,
    subcommands: () => ['party'],

    async run(ctx: Context): Promise<void> {
      const first = ctx.args.split(/\s+/, 1)[0]?.toLowerCase();
      if (first === 'party') {
        await runParty(ctx);
        return;
      }
      if (ctx.mentions.length === 0) {
        await ctx.replyEphemeral(trusted('Usage: `.sparkle @user [reason]` — pick the user from autocomplete.'));
        return;
      }

      const humans: User[] = [];
      for (const target of ctx.mentions) {
        if (target.id === ctx.botUserId) {
          await ctx.reply(
            messages.botSparkleQuip({
              giver: fmt`*${ctx.giver.name}*`,
              user: fmt`*${target.name}*`,
              currency: config.currency,
            }),
          );
        } else if (target.id === ctx.giver.id) {
          await runSelf(ctx);
        } else {
          humans.push(target);
        }
      }
      if (humans.length > 0) await awardHumans(ctx, humans);
    },
  };
}
