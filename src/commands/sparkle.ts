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
}

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

  async function awardHumans(ctx: Context, targets: User[]): Promise<void> {
    // Pre-compute first-sparkle flags, then write all rows in one transaction, then post.
    const firstFlags = new Map(targets.map((t) => [t.id, ctx.store.isFirstSparkle(t.id)]));
    const rows: SparkleRow[] = targets.map((t) => ({
      giverId: ctx.giver.id,
      giverName: ctx.giver.name,
      receiverId: t.id,
      receiverName: t.name,
      reason: normalizeReason(ctx.args) || null,
      channelId: ctx.channel.id,
      channelName: ctx.channel.name,
    }));
    ctx.store.insertSparkles(rows);

    for (const t of targets) {
      const total = ctx.store.getTotalReceived(t.id);
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

    ctx.store.insertSparkles(
      recipients.map((r) => ({
        giverId: ctx.giver.id, giverName: ctx.giver.name,
        receiverId: r.id, receiverName: r.name,
        reason: 'party',
        channelId: ctx.channel.id, channelName: ctx.channel.name,
      })),
    );

    const lines = recipients.map((r) => {
      const total = ctx.store.getTotalReceived(r.id);
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
