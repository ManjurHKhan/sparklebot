import type { SafeText } from './safe.js';
import type { Store } from '../store/store.js';

export enum AccessLevel {
  Everyone = 'everyone',
  Restricted = 'restricted',
}

/** A resolved Slack user (confirmed live via users.info). */
export interface User {
  id: string;
  name: string;
  /** true for is_bot OR is_app_user. In ctx.mentions only our own bot ever has this true. */
  isBot: boolean;
}

/** Read-only Slack resolution surface. No posting methods, by construction. */
export interface ResolverApi {
  resolveUser(id: string): Promise<User | null>;
  channelName(id: string): Promise<string>;
  /** Distinct non-bot user IDs who posted in the channel in the last N minutes, excluding one user. */
  recentHumanUserIds(channelId: string, sinceMinutes: number, excludeUserId: string): Promise<string[]>;
}

export interface Context {
  /** Command token without the dot, e.g. "sparkle". */
  command: string;
  /** Args text with leading mention tokens stripped (i.e. the reason / subcommand text). */
  args: string;
  /** Resolved targets. Always live humans, or our own bot (the one carve-out). Deduped. */
  mentions: User[];
  /** Resolved human giver. The giver gate guarantees isBot === false. */
  giver: User;
  channel: { id: string; name: string };
  botUserId: string;
  reply(msg: SafeText): Promise<void>;
  replyEphemeral(msg: SafeText): Promise<void>;
  /** DM the giver; falls back to ephemeral channel reply if the DM fails. */
  replyDM(msg: SafeText): Promise<void>;
  react(emoji: string): Promise<void>;
  /** Sliding-window budget bound to the giver. Charge before awarding. */
  rate: { tryConsume(n: number): boolean };
  store: Store;
  resolver: ResolverApi;
  log(...args: unknown[]): void;
}

export interface Command {
  name(): string;
  aliases(): string[];
  help(): string;
  access(): AccessLevel;
  /** If true, dispatcher runs target-resolution + caps middleware. */
  takesTargets(): boolean;
  /** First-token keywords that bypass target resolution (e.g. "party"). */
  subcommands(): string[];
  run(ctx: Context): Promise<void>;
}
