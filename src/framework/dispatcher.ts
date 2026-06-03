import { isSafe, trusted, type SafeText } from './safe.js';
import { withRetry } from './resolver.js';
import { AccessLevel, type Command, type Context, type ResolverApi, type User } from './types.js';
import type { Registry } from './registry.js';
import type { SlidingWindow } from './rate-limit.js';
import type { Store } from '../store/store.js';

const TOKEN_RE = /^\.([a-z][a-z0-9_-]*)(?:\s+|$)/i;
const LEADING_MENTION_RE = /^<@([A-Z0-9]+)(?:\|[^>]*)?>\s*/;
const MENTION_ANYWHERE_RE = /<@[A-Z0-9]+(?:\|[^>]*)?>/;
const BROADCAST_RE = /<!(?:here|channel|everyone)(?:\|[^>]*)?>|<!subteam\^[^>]*>/;
const MAX_TARGETS = 10;
const MAX_REASON = 256;

/** Minimal posting slice of WebClient the dispatcher owns. Plugins never see it. */
export interface SlackPostClient {
  chat: {
    postMessage(args: { channel: string; text: string }): Promise<unknown>;
    postEphemeral(args: { channel: string; user: string; text: string }): Promise<unknown>;
  };
  conversations: { open(args: { users: string }): Promise<any> };
  reactions: { add(args: { channel: string; timestamp: string; name: string }): Promise<unknown> };
}

export interface DispatcherDeps {
  registry: Registry;
  resolver: ResolverApi;
  store: Store;
  rateLimiter: SlidingWindow;
  botUserId: string;
  client: SlackPostClient;
  log: (...args: unknown[]) => void;
  /** Restricted-command allowlist (user IDs). Empty in v0.1 — no restricted command ships. */
  restrictedAllowlist?: Set<string>;
}

interface IncomingMessage {
  type: string;
  subtype?: string;
  bot_id?: string;
  text?: string;
  user?: string;
  channel: string;
  ts: string;
}

export function createDispatcher(deps: DispatcherDeps) {
  const { registry, resolver, store, rateLimiter, botUserId, client, log } = deps;

  return async function dispatch({ message }: { message: IncomingMessage }): Promise<void> {
    // 1. Eligibility: human-authored channel message with text.
    if (!message?.text || !message.user || message.subtype || message.bot_id) {
      if (process.env.DEBUG_DISPATCHER) log('DISPATCH: Returning early, message:', { text: message?.text, user: message?.user, subtype: message?.subtype, bot_id: message?.bot_id });
      return;
    }

    // 2. Token parse + lookup. Unknown .token → silently ignored (not a command).
    const tokenMatch = message.text.match(TOKEN_RE);
    if (!tokenMatch) return;
    const command = registry.lookup(tokenMatch[1]!.toLowerCase());
    if (!command) return;
    const rawArgs = message.text.slice(tokenMatch[0].length).trim();

    // Last line of defense at the output boundary: reject anything that isn't a real SafeText
    // instance (typos, casts, forged literals). Throws at runtime in every environment.
    const assertSafe = (msg: SafeText): void => {
      if (!isSafe(msg)) throw new Error('output boundary requires a SafeText built via fmt/trusted/joinSafe');
    };

    // All outbound posts go through withRetry: a transient 429/network failure after a DB
    // write must not leave a sparkle recorded but unannounced.
    const ephemeral = async (msg: SafeText) => {
      assertSafe(msg);
      try {
        await withRetry(() =>
          client.chat.postEphemeral({ channel: message.channel, user: message.user!, text: msg.text }),
        );
      } catch (err) {
        log('postEphemeral failed', err);
      }
    };

    try {
      // 3. Human-giver gate — deny by default. Resolution by API response, not ID shape.
      const giver = await resolver.resolveUser(message.user);
      if (!giver || giver.isBot) {
        await ephemeral(trusted('Only humans can use this command.'));
        return;
      }

      // 4. Access check.
      if (command.access() === AccessLevel.Restricted && !deps.restrictedAllowlist?.has(giver.id)) {
        await ephemeral(trusted('You are not allowed to use this command.'));
        return;
      }

      // 5. Broadcast tags are never valid input.
      if (BROADCAST_RE.test(rawArgs)) {
        await ephemeral(trusted('Broadcast tags (@here/@channel/groups) are not allowed.'));
        return;
      }

      // 6. Target resolution + caps (only for target-taking commands, skipping declared subcommands).
      let mentions: User[] = [];
      let args = rawArgs;
      const firstToken = rawArgs.split(/\s+/, 1)[0] ?? '';
      const isSubcommand = command.subcommands().includes(firstToken.toLowerCase());

      // `.{cmd} help` shows that command's help (repo-authored → trusted), bypassing all
      // target/caps middleware. Generic, so every command gets it for free.
      if (firstToken.toLowerCase() === 'help') {
        await ephemeral(trusted(command.help()));
        return;
      }

      if (command.takesTargets() && !isSubcommand && rawArgs.length > 0) {
        let remaining = rawArgs;
        const ids: string[] = [];
        for (;;) {
          const m = remaining.match(LEADING_MENTION_RE);
          if (!m) break;
          ids.push(m[1]!);
          remaining = remaining.slice(m[0].length);
        }
        args = remaining.trim();

        if (ids.length === 0) {
          await ephemeral(trusted('Target someone with a real @-mention (autocomplete), not plain text.'));
          return;
        }
        // Mentions are positional: targets lead, reason follows. A mention smuggled into the
        // reason is ambiguous intent — reject with a named reason rather than echo it as text.
        if (MENTION_ANYWHERE_RE.test(args)) {
          await ephemeral(trusted('Put all @-mentions before the reason — found one inside the reason text.'));
          return;
        }
        if (ids.length > MAX_TARGETS) {
          await ephemeral(trusted(`Too many targets — max ${MAX_TARGETS} per command.`));
          return;
        }
        if (args.length > MAX_REASON) {
          await ephemeral(trusted(`Reason too long — max ${MAX_REASON} characters.`));
          return;
        }

        // Resolve every target; validate by API response. Dedup AFTER resolution.
        const seen = new Set<string>();
        for (const id of ids) {
          const u = await resolver.resolveUser(id);
          if (!u) {
            await ephemeral(trusted("Couldn't resolve one of those users (deleted or unknown) — sparkle not sent."));
            return;
          }
          if (u.isBot && u.id !== botUserId) {
            await ephemeral(trusted('Bots and apps can\'t receive sparkles.'));
            return;
          }
          if (seen.has(u.id)) continue;
          seen.add(u.id);
          mentions.push(u);
        }

        // 7. Rate limit: charge awardable targets (humans other than the giver; own-bot quip and
        // self-gag award nothing). Party charges inside the plugin via ctx.rate.
        const awardable = mentions.filter((u) => u.id !== giver.id && u.id !== botUserId).length;
        if (awardable > 0 && !rateLimiter.tryConsume(giver.id, awardable)) {
          await ephemeral(trusted('Rate limit hit — slow down and spread the sparkle later.'));
          return;
        }
      }

      // 8. Build Context and run.
      const channelName = await resolver.channelName(message.channel);
      const ctx: Context = {
        command: command.name(),
        args,
        mentions,
        giver,
        channel: { id: message.channel, name: channelName },
        botUserId,
        reply: async (msg) => {
          assertSafe(msg);
          await withRetry(() => client.chat.postMessage({ channel: message.channel, text: msg.text }));
        },
        replyEphemeral: ephemeral,
        replyDM: async (msg) => {
          assertSafe(msg);
          try {
            const dm = await withRetry(() => client.conversations.open({ users: giver.id }));
            await withRetry(() => client.chat.postMessage({ channel: dm.channel.id, text: msg.text }));
          } catch {
            await ephemeral(msg); // closed-DM fallback — never fail silently
          }
        },
        react: async (emoji) => {
          try {
            await withRetry(() =>
              client.reactions.add({ channel: message.channel, timestamp: message.ts, name: emoji }),
            );
          } catch (err) {
            log('reaction failed', err);
          }
        },
        rate: { tryConsume: (n: number) => rateLimiter.tryConsume(giver.id, n) },
        store,
        resolver,
        log,
      };

      await command.run(ctx);
    } catch (err) {
      // A command error must never crash the process or wedge silently.
      log(`command .${command.name()} failed:`, err);
      await ephemeral(trusted('Something went wrong running that command.'));
    }
  };
}
