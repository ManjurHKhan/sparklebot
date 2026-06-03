import { describe, it, expect } from 'vitest';
import { Registry } from '../src/framework/registry.js';
import { createHelpCommand } from '../src/commands/help.js';
import { AccessLevel, type Command, type Context } from '../src/framework/types.js';

function stubCommand(name: string, aliases: string[] = [], help = `${name} help line`): Command {
  return {
    name: () => name,
    aliases: () => aliases,
    help: () => help,
    access: () => AccessLevel.Everyone,
    takesTargets: () => false,
    subcommands: () => [],
    run: async () => {},
  };
}

describe('Registry', () => {
  it('looks up by name and alias', () => {
    const r = new Registry();
    const c = stubCommand('sparkle', ['spark']);
    r.register(c);
    expect(r.lookup('sparkle')).toBe(c);
    expect(r.lookup('spark')).toBe(c);
    expect(r.lookup('nope')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    const r = new Registry();
    r.register(stubCommand('a'));
    expect(() => r.register(stubCommand('a'))).toThrow(/duplicate/i);
  });

  it('builds help text from all commands', () => {
    const r = new Registry();
    r.register(stubCommand('sparkle'));
    r.register(stubCommand('sparkles'));
    const help = r.helpText();
    expect(help.text).toContain('sparkle help line');
    expect(help.text).toContain('sparkles help line');
  });
});

describe('.help command', () => {
  it('replies with registry help', async () => {
    const r = new Registry();
    r.register(stubCommand('sparkle'));
    const helpCmd = createHelpCommand(r);
    r.register(helpCmd);
    let sent = '';
    const ctx = { reply: async (m: { text: string }) => { sent = m.text; } } as unknown as Context;
    await helpCmd.run(ctx);
    expect(sent).toContain('sparkle help line');
  });
});
