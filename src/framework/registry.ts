import { joinSafe, trusted, type SafeText } from './safe.js';
import type { Command } from './types.js';

export class Registry {
  private byToken = new Map<string, Command>();
  private commands: Command[] = [];

  register(cmd: Command): void {
    const tokens = [cmd.name(), ...cmd.aliases()];
    for (const t of tokens) {
      if (this.byToken.has(t)) throw new Error(`duplicate command token: ${t}`);
    }
    for (const t of tokens) this.byToken.set(t, cmd);
    this.commands.push(cmd);
  }

  lookup(token: string): Command | undefined {
    return this.byToken.get(token);
  }

  all(): Command[] {
    return [...this.commands];
  }

  /** Help text is repo-authored (Command.help()) — trusted by definition. */
  helpText(): SafeText {
    const lines = this.commands.map((c) => trusted(c.help()));
    return joinSafe([trusted('*Commands*'), ...lines], '\n');
  }
}
