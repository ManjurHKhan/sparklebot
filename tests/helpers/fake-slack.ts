import { vi } from 'vitest';

export interface FakeUser {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  /** When present (even ''), used as profile.display_name instead of `name`. */
  display_name?: string;
  is_workflow_bot?: boolean;
  is_agentforce_bot?: boolean;
  is_sidekick_bot?: boolean;
  /** Extra profile fields (e.g. bot_id, is_sidekick_bot). */
  profile?: Record<string, unknown>;
}

interface PostedMessage {
  channel: string;
  text: string;
  parse?: 'none';
  unfurl_links?: false;
  unfurl_media?: false;
}

type EphemeralMessage = PostedMessage & { user: string };

export function makeFakeSlack(opts: {
  users?: FakeUser[];
  channels?: Record<string, string>; // id -> name
  history?: Array<{ user?: string; bot_id?: string }>;
  botUserId?: string;
  archivedChannels?: string[];
  privateChannels?: string[];
} = {}) {
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const posts: PostedMessage[] = [];
  const ephemerals: EphemeralMessage[] = [];
  const reactions: Array<{ channel: string; timestamp: string; name: string }> = [];

  const client = {
    users: {
      info: vi.fn(async ({ user }: { user: string }) => {
        const u = users.get(user);
        if (!u) throw new Error('user_not_found');
        return {
          ok: true,
          user: {
            id: u.id,
            name: u.name ?? 'someone',
            deleted: u.deleted ?? false,
            is_bot: u.is_bot ?? false,
            is_app_user: u.is_app_user ?? false,
            is_restricted: u.is_restricted ?? false,
            is_ultra_restricted: u.is_ultra_restricted ?? false,
            ...(u.is_workflow_bot !== undefined && { is_workflow_bot: u.is_workflow_bot }),
            ...(u.is_agentforce_bot !== undefined && { is_agentforce_bot: u.is_agentforce_bot }),
            ...(u.is_sidekick_bot !== undefined && { is_sidekick_bot: u.is_sidekick_bot }),
            real_name: u.name ?? 'Someone',
            profile: {
              display_name: 'display_name' in u ? u.display_name : (u.name ?? 'someone'),
              real_name: u.name ?? 'Someone',
              ...u.profile,
            },
          },
        };
      }),
    },
    conversations: {
      info: vi.fn(async ({ channel }: { channel: string }) => {
        const name = (opts.channels ?? {})[channel];
        if (!name) throw new Error('channel_not_found');
        return {
          ok: true,
          channel: {
            name,
            is_archived: (opts.archivedChannels ?? []).includes(channel),
            is_private: (opts.privateChannels ?? []).includes(channel),
          },
        };
      }),
      history: vi.fn(async () => ({ ok: true, messages: opts.history ?? [] })),
      open: vi.fn(async ({ users: u }: { users: string }) => ({
        ok: true,
        channel: { id: `D-${u}` },
      })),
    },
    chat: {
      postMessage: vi.fn(async (args: PostedMessage) => {
        posts.push(args);
        return { ok: true };
      }),
      postEphemeral: vi.fn(async (args: EphemeralMessage) => {
        ephemerals.push(args);
        return { ok: true };
      }),
    },
    reactions: {
      add: vi.fn(async (args: { channel: string; timestamp: string; name: string }) => {
        reactions.push(args);
        return { ok: true };
      }),
    },
    auth: {
      test: vi.fn(async () => ({ ok: true, user_id: opts.botUserId ?? 'U0FAKEBOT9' })),
    },
  };

  return { client, posts, ephemerals, reactions };
}
