import type { Registry } from '../framework/registry.js';
import { AccessLevel, type Command, type Context } from '../framework/types.js';

export function createHelpCommand(registry: Registry): Command {
  return {
    name: () => 'help',
    aliases: () => [],
    help: () => '`.help` — show this list',
    access: () => AccessLevel.Everyone,
    takesTargets: () => false,
    subcommands: () => [],
    async run(ctx: Context): Promise<void> {
      await ctx.reply(registry.helpText());
    },
  };
}
