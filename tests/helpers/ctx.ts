import { vi } from 'vitest';
import { createSqliteStore } from '../../src/store/sqlite.js';
import type { Context, User } from '../../src/framework/types.js';
import type { SafeText } from '../../src/framework/safe.js';

export const BOT = 'U0FAKEBOT9';
export const GIVER: User = { id: 'U0FAKE0001', name: 'alice', isBot: false };

export function makeCtx(over: Partial<Context> = {}) {
  const store = createSqliteStore(':memory:');
  const replies: string[] = [];
  const ephemerals: string[] = [];
  const dms: string[] = [];
  const ctx: Context = {
    command: 'sparkle',
    args: '',
    mentions: [],
    giver: GIVER,
    channel: { id: 'C0FAKE0001', name: 'general' },
    botUserId: BOT,
    reply: vi.fn(async (m: SafeText) => { replies.push(m.text); }),
    replyEphemeral: vi.fn(async (m: SafeText) => { ephemerals.push(m.text); }),
    replyDM: vi.fn(async (m: SafeText) => { dms.push(m.text); }),
    react: vi.fn(async () => {}),
    rate: { tryConsume: () => true },
    store,
    resolver: {
      resolveUser: async (id) => ({ id, name: 'resolved', isBot: false }),
      channelName: async () => 'general',
      recentHumanUserIds: async () => [],
    },
    log: () => {},
    ...over,
  };
  return { ctx, store, replies, ephemerals, dms };
}
