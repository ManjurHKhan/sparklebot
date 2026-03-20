import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSparkle } from '../../src/handlers/sparkle.js';
import { createDb } from '../../src/db.js';
import { createMessages } from '../../src/messages.js';
import loadConfig from '../../src/config.js';

function makeMockClient() {
  return {
    users: { info: vi.fn().mockResolvedValue({ user: { profile: { display_name: 'TestUser' }, real_name: 'Test User', name: 'testuser' } }) },
    conversations: {
      history: vi.fn(),
      info: vi.fn().mockResolvedValue({ channel: { name: 'test-channel' } }),
    },
    auth: { test: vi.fn().mockResolvedValue({ user_id: 'UBOT', team_id: 'T1234' }) },
    chat: { postMessage: vi.fn().mockResolvedValue({}) },
  };
}

describe('handleSparkle integration', () => {
  let db, messages, config, mockClient;

  beforeEach(() => {
    db = createDb(':memory:');
    messages = createMessages('playful');
    config = loadConfig();
    mockClient = makeMockClient();
  });

  it('records sparkle and posts message with bold names', async () => {
    const message = { text: '.sparkle <@U2> great work', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(db.getTotalReceived('U2')).toBe(1);
    // First sparkle uses celebration template -- names should be bold
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    expect(call.text).toContain('*TestUser*');
  });

  it('stores giver name and channel name in DB', async () => {
    const message = { text: '.sparkle <@U2> great work', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    const activity = db.getRecentActivity(1);
    expect(activity[0].giver_name).toBe('TestUser');
    expect(activity[0].channel_name).toBe('test-channel');
  });

  it('allows self-sparkle first time', async () => {
    const message = { text: '.sparkle <@U1> self love', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks self-sparkle second time with bold name in shame message', async () => {
    const message = { text: '.sparkle <@U1> self love', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(2);
    const shameCall = mockClient.chat.postMessage.mock.calls[1][0];
    expect(shameCall.text).toContain('*TestUser*');
  });

  it('detects first sparkle and posts celebration', async () => {
    const message = { text: '.sparkle <@U2>', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    expect(call.text).toBeTruthy();
    expect(db.getTotalReceived('U2')).toBe(1);
  });

  it('posts regular format on second sparkle with bold names and count', async () => {
    const message = { text: '.sparkle <@U2> nice', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U2')).toBe(2);
    const secondCall = mockClient.chat.postMessage.mock.calls[1][0];
    expect(secondCall.text).toContain('*2*');
    expect(secondCall.text).toContain('*TestUser*');
  });

  it('handles plain text target', async () => {
    const message = { text: '.sparkle bob great job', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('bob')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it('handles multiple mention targets', async () => {
    const message = { text: '.sparkle <@U2> <@U3> teamwork', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U2')).toBe(1);
    expect(db.getTotalReceived('U3')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('handles party mode with recent posters', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [
        { user: 'U2', ts: '1234' },
        { user: 'U3', ts: '1235' },
        { user: 'U1', ts: '1236' },
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

  it('party mode skips duplicate users', async () => {
    mockClient.conversations.history.mockResolvedValue({
      messages: [
        { user: 'U2', ts: '1234' },
        { user: 'U2', ts: '1235' },
        { user: 'U3', ts: '1236' },
      ],
    });
    const message = { text: '.sparkle party', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U2')).toBe(1);
    expect(db.getTotalReceived('U3')).toBe(1);
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

  it('does nothing for non-sparkle messages', async () => {
    const message = { text: 'hello world', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('does nothing for .sparkle with no target', async () => {
    const message = { text: '.sparkle ', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('deduplicates repeated mention targets', async () => {
    const message = { text: '.sparkle <@U2> <@U2> <@U2> great', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(db.getTotalReceived('U2')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it('responds with bot quip when sparkling the bot and does not record it', async () => {
    const message = { text: '.sparkle <@UBOT> thanks', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(db.getTotalReceived('UBOT')).toBe(0);
    const quipCall = mockClient.chat.postMessage.mock.calls[0][0];
    expect(quipCall.text).toBeTruthy();
    // Verify auth.test was called to detect bot user
    expect(mockClient.auth.test).toHaveBeenCalled();
  });

  it('handles mix of bot, self, and normal targets', async () => {
    const message = { text: '.sparkle <@UBOT> <@U1> <@U2> reason', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, messages, config });
    // Bot gets quip, self gets sparkle (first time), U2 gets sparkle
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(3);
    expect(db.getTotalReceived('UBOT')).toBe(0);
    expect(db.getTotalReceived('U1')).toBe(1);
    expect(db.getTotalReceived('U2')).toBe(1);
  });
});
