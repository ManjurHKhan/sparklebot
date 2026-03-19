/**
 * Aggregation batcher for sparkle events.
 * Groups sparkles by receiverId:channelId with debounce timers capped by maxSeconds.
 */

export function createBatcher(config, onFlush) {
  const { initialSeconds, extendSeconds, maxSeconds } = config;
  const batches = new Map();

  function flush(key) {
    const entry = batches.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    batches.delete(key);
    onFlush({ receiverId: entry.receiverId, channelId: entry.channelId, sparkles: entry.sparkles });
  }

  function scheduleFlush(key) {
    const entry = batches.get(key);
    if (!entry) return;

    clearTimeout(entry.timer);

    const elapsed = Date.now() - entry.startTime;
    const remaining = maxSeconds * 1000 - elapsed;
    const delay = Math.min(extendSeconds * 1000, remaining);

    entry.timer = setTimeout(() => flush(key), delay);
  }

  return {
    add(sparkle) {
      const { receiverId, channelId } = sparkle;
      const key = `${receiverId}:${channelId}`;

      if (!batches.has(key)) {
        batches.set(key, {
          receiverId,
          channelId,
          sparkles: [],
          timer: null,
          startTime: Date.now(),
        });
        // Use initialSeconds for the first timer
        const entry = batches.get(key);
        entry.sparkles.push(sparkle);
        entry.timer = setTimeout(() => flush(key), initialSeconds * 1000);
      } else {
        const entry = batches.get(key);
        entry.sparkles.push(sparkle);
        scheduleFlush(key);
      }
    },

    flushAll() {
      for (const key of [...batches.keys()]) {
        flush(key);
      }
    },
  };
}
