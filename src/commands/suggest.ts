import { fmt, trusted } from '../framework/safe.js';
import { AccessLevel, type Command, type Context } from '../framework/types.js';
import type { Cooldown } from '../framework/rate-limit.js';

// Same as fmt's field cap, so an accepted idea is never truncated.
const MAX_IDEA = 256;

export function createSuggestCommand(deps: { cooldown: Cooldown }): Command {
  return {
    name: () => 'suggest',
    aliases: () => [],
    help: () => '`.suggest [idea]` — send an idea to the Sparklebot team',
    access: () => AccessLevel.Everyone,
    takesTargets: () => false,
    subcommands: () => [],

    async run(ctx: Context): Promise<void> {
      const idea = ctx.args.trim();
      if (!idea) {
        await ctx.replyEphemeral(trusted('Usage: `.suggest [idea]` — tell me what Sparklebot should do next.'));
        return;
      }
      if (idea.length > MAX_IDEA) {
        await ctx.replyEphemeral(trusted(`That's a lot of idea. Keep it to ${MAX_IDEA} characters.`));
        return;
      }
      // Charged only after the input passes, so a typo doesn't cost a 10-minute wait.
      if (!deps.cooldown.try(ctx.giver.id)) {
        await ctx.replyEphemeral(trusted('One suggestion every 10 minutes. Hold that thought!'));
        return;
      }
      const sent = await ctx.notifyOwner(fmt`💡 Suggestion from *${ctx.giver.name}* in #${ctx.channel.name}: ${idea}`);
      await ctx.replyEphemeral(
        sent
          ? trusted('💡 Thanks! Your idea went to the Sparklebot team.')
          : trusted("Couldn't deliver that right now. Try again later."),
      );
    },
  };
}
