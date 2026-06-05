import { vi } from 'vitest';

export interface FakeUser {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
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
            real_name: u.name ?? 'Someone',
            profile: { display_name: u.name ?? 'someone', real_name: u.name ?? 'Someone' },
          },
        };
      }),
    },
    conversations: {
      info: vi.fn(async ({ channel }: { channel: string }) => {
        const name = (opts.channels ?? {})[channel];
        if (!name) throw new Error('channel_not_found');
        return { ok: true, channel: { name } };
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
