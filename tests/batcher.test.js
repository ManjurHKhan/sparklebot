import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBatcher } from '../src/batcher.js';

describe('batcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes after initial wait with single sparkle', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice', reason: 'nice' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch = onFlush.mock.calls[0][0];
    expect(batch.receiverId).toBe('U1');
    expect(batch.channelId).toBe('C1');
    expect(batch.sparkles).toHaveLength(1);
  });

  it('extends timer when second sparkle arrives', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    vi.advanceTimersByTime(1000);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U3', giverName: 'bob' });

    vi.advanceTimersByTime(1500);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sparkles).toHaveLength(2);
  });

  it('respects max cap', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 5 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U3', giverName: 'bob' });
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U4', giverName: 'carol' });
    vi.advanceTimersByTime(1500);
    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U5', giverName: 'dave' });

    vi.advanceTimersByTime(1000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sparkles).toHaveLength(4);
  });

  it('keeps separate batches for different recipients', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U3', channelId: 'C1', giverId: 'U2', giverName: 'alice' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('keeps separate batches for different channels', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 2, extendSeconds: 2, maxSeconds: 10 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U1', channelId: 'C2', giverId: 'U3', giverName: 'bob' });

    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('flushAll immediately flushes all pending batches', () => {
    const onFlush = vi.fn();
    const batcher = createBatcher({ initialSeconds: 15, extendSeconds: 15, maxSeconds: 120 }, onFlush);

    batcher.add({ receiverId: 'U1', channelId: 'C1', giverId: 'U2', giverName: 'alice' });
    batcher.add({ receiverId: 'U3', channelId: 'C1', giverId: 'U4', giverName: 'bob' });

    batcher.flushAll();
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
