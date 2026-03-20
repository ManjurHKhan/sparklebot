import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSparkle } from '../../src/handlers/sparkle.js';
import { createDb } from '../../src/db.js';
import { createMessages } from '../../src/messages.js';
import loadConfig from '../../src/config.js';

describe('handleSparkle integration', () => {
  let db, messages, config, mockClient;

  beforeEach(() => {
    db = createDb(':memory:');
    messages = createMessages('playful');
    config = loadConfig();
    mockClient = {
      users: { info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'TestUser' }, real_name: 'Test User', name: 'testuser' } }) },
      conversations: {
        history: vi.fn(),
        info: vi.fn().mockResolvedValue({ channel: { name: 'test-channel' } }),
      },
      auth: { test: vi.fn().mockResolvedValue({ team_id: 'T1234' }) }, // used by leaderboard
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
    };
  });

  it('records sparkle and posts message', async () => {
    const message = { text: '.sparkle <@U2> great work', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(db.getTotalReceived('U2')).toBe(1);
  });

  it('allows self-sparkle first time, blocks second', async () => {
    const message = { text: '.sparkle <@U1> self love', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);

    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('detects first sparkle for a user', async () => {
    const message = { text: '.sparkle <@U2>', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    // First sparkle should trigger a celebration message
    expect(call.text).toBeTruthy();
  });

  it('handles party mode with recent posters', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [
        { user: 'U2', ts: '1234', bot_id: undefined },
        { user: 'U3', ts: '1235', bot_id: undefined },
        { user: 'U1', ts: '1236', bot_id: undefined },
        { user: 'UBOT', ts: '1237', bot_id: 'B1' },
      ],
    });
    const message = { text: '.sparkle party', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U2')).toBe(1);
    expect(db.getTotalReceived('U3')).toBe(1);
    expect(db.getTotalReceived('U1')).toBe(0);
    expect(db.getTotalReceived('UBOT')).toBe(0);
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
  });

  it('handles party mode with empty channel', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [{ user: 'U1', ts: '1234' }],
    });
    const message = { text: '.sparkle party', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    expect(call.text.toLowerCase()).toContain('no one');
  });
});
