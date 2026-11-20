import { channelLink, fmt, isSafe, joinSafe, trusted, userMention, type SafeText } from './safe.js';
import { SLACK_TEXT_CONTROLS } from './dispatcher.js';
import { withRetry } from './resolver.js';
import type { ResolverApi } from './types.js';
import type { Store } from '../store/store.js';
import type { Messages } from '../messages.js';
import type { WelcomeChannel } from '../config.js';

/** Posting slice the welcome needs. Framework code only: plugins never see a raw client. */
export interface WelcomeClient {
  chat: { postMessage(args: { channel: string; text: string } & typeof SLACK_TEXT_CONTROLS): Promise<unknown> };
  conversations: { open(args: { users: string }): Promise<any>; info(args: { channel: string }): Promise<any> };
}

export interface WelcomeDeps {
  client: WelcomeClient;
  resolver: ResolverApi;
  store: Store;
  messages: Messages;
  botUserId: string;
  megaBurst: SafeText;
  suggestEnabled: boolean;
  config: { welcomeChannel: string; welcomeChannels: WelcomeChannel[]; currency: string; currencyPlural: string };
  log: (...args: unknown[]) => void;
}

const slackError = (err: unknown) => (err as { data?: { error?: string } })?.data?.error ?? String(err);

export function createWelcomeHandler(deps: WelcomeDeps) {
  const { client, resolver, store, messages, botUserId, megaBurst, suggestEnabled, config, log } = deps;

  const post = async (channel: string, msg: SafeText): Promise<void> => {
    if (!isSafe(msg)) throw new Error('output boundary requires a SafeText built via fmt/trusted/joinSafe');
    await withRetry(() => client.chat.postMessage({ channel, text: msg.text, ...SLACK_TEXT_CONTROLS }));
  };

  /** Tour rows for channels that are still public and unarchived right now. */
  async function tour(): Promise<SafeText[]> {
    const rows: SafeText[] = [];
    for (const c of config.welcomeChannels) {
      try {
        const ch = (await withRetry(() => client.conversations.info({ channel: c.id })))?.channel;
        if (!ch || ch.is_archived || ch.is_private) {
          log(`welcome tour: skipping ${c.id} (archived, private or missing)`);
          continue;
        }
        rows.push(fmt`• ${channelLink(c.id)}: ${c.about}`);
      } catch (err) {
        log(`welcome tour: skipping ${c.id}: ${slackError(err)}`);
      }
    }
    return rows;
  }

  return async function onTeamJoin(event: { user?: { id?: string } }): Promise<void> {
    const id = event.user?.id;
    if (!id) return;
    // Re-resolve rather than trust the event payload. Skipped people are not claimed.
    const user = await resolver.resolveUser(id);
    if (!user || user.isBot || user.isGuest) {
      log(`welcome: skipping ${id} (not a full member)`);
      return;
    }
    const channel = config.welcomeChannel;
    const channelName = await resolver.channelName(channel);
    // One transaction: a claimed member always has their sparkle. Posts are not re-sent if
    // they fail after this (withRetry covers transient errors), same as every sparkle post.
    const claimed = store.claimWelcome({
      giverId: botUserId, giverName: 'Sparklebot',
      receiverId: user.id, receiverName: user.name,
      reason: 'welcome',
      channelId: channel, channelName,
    });
    if (!claimed) return; // Slack redelivered the event

    const publicBranch = async () => {
      await post(channel, messages.welcomePublic({ mention: userMention(user.id), currency: config.currency }));
      await post(channel, megaBurst);
    };
    const dmBranch = async () => {
      const dm = await withRetry(() => client.conversations.open({ users: user.id }));
      const parts: SafeText[] = [
        messages.welcomeDM({ user: fmt`*${user.name}*`, currency: config.currency, currencyPlural: config.currencyPlural }),
      ];
      const rows = await tour();
      if (rows.length > 0) parts.push(joinSafe([trusted('A few channels worth joining:'), ...rows], '\n'));
      parts.push(fmt`*How it works:*
• \`.sparkle @someone [reason]\` gives a teammate a ${config.currency}
• \`.sparkles\` shows the leaderboard
• \`.help\` lists everything I can do`);
      if (suggestEnabled) parts.push(trusted('Got an idea for me? Type `.suggest [your idea]`'));
      await post(dm.channel.id, joinSafe(parts, '\n\n'));
    };

    // Independent: a bot missing from the welcome channel must not cost the member their DM.
    const [pub, dm] = await Promise.allSettled([publicBranch(), dmBranch()]);
    if (pub.status === 'rejected') log(`welcome: public post failed for ${user.id}: ${slackError(pub.reason)}`);
    if (dm.status === 'rejected') log(`welcome: DM failed for ${user.id}: ${slackError(dm.reason)}`);
  };
}
