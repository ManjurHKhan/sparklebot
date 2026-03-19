import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSparkle } from '../../src/handlers/sparkle.js';
import { createDb } from '../../src/db.js';
import { createMessages } from '../../src/messages.js';
import loadConfig from '../../src/config.js';

describe('handleSparkle integration', () => {
  let db, messages, config, mockClient, mockBatcher;

  beforeEach(() => {
    db = createDb(':memory:');
    messages = createMessages('playful');
    config = loadConfig();
    mockClient = {
      users: { list: vi.fn().mockResolvedValue({ members: [] }) },
      conversations: { history: vi.fn(), open: vi.fn() },
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
    };
    mockBatcher = { add: vi.fn() };
  });

  it('records sparkle and adds to batcher', async () => {
    const message = { text: '.sparkle <@U2> great work', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(mockBatcher.add).toHaveBeenCalledTimes(1);
    expect(db.getTotalReceived('U2')).toBe(1);
  });

  it('allows self-sparkle first time, blocks second', async () => {
    const message = { text: '.sparkle <@U1> self love', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);

    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(db.getTotalReceived('U1')).toBe(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
  });

  it('detects first sparkle for a user', async () => {
    const message = { text: '.sparkle <@U2>', user: 'U1', channel: 'C1' };
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    const addCall = mockBatcher.add.mock.calls[0][0];
    expect(addCall.isFirstSparkle).toBe(true);
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
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
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
    await handleSparkle({ message, client: mockClient, db, batcher: mockBatcher, messages, config });
    expect(mockClient.chat.postMessage).toHaveBeenCalled();
    const call = mockClient.chat.postMessage.mock.calls[0][0];
    expect(call.text.toLowerCase()).toContain('no one');
  });
});
