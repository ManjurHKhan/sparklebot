import { describe, it, expect } from 'vitest';
import { SlidingWindow, Cooldown } from '../src/framework/rate-limit.js';

describe('SlidingWindow', () => {
  it('allows up to limit within the window, counts n per consume', () => {
    let t = 0;
    const w = new SlidingWindow(10, 60_000, () => t);
    expect(w.tryConsume('u1', 9)).toBe(true);
    expect(w.tryConsume('u1', 2)).toBe(false); // 9 + 2 > 10
    expect(w.tryConsume('u1', 1)).toBe(true);  // exactly 10
    expect(w.tryConsume('u1', 1)).toBe(false);
  });

  it('frees budget after the window slides', () => {
    let t = 0;
    const w = new SlidingWindow(10, 60_000, () => t);
    expect(w.tryConsume('u1', 10)).toBe(true);
    t = 59_000;
    expect(w.tryConsume('u1', 1)).toBe(false);
    t = 61_000;
    expect(w.tryConsume('u1', 10)).toBe(true);
  });

  it('keys are independent', () => {
    const w = new SlidingWindow(1, 60_000, () => 0);
    expect(w.tryConsume('u1')).toBe(true);
    expect(w.tryConsume('u2')).toBe(true);
  });

  it('a failed consume does not burn budget', () => {
    let t = 0;
    const w = new SlidingWindow(10, 60_000, () => t);
    expect(w.tryConsume('u1', 11)).toBe(false);
    expect(w.tryConsume('u1', 10)).toBe(true);
  });
});

describe('Cooldown', () => {
  it('blocks repeat hits inside the period', () => {
    let t = 0;
    const c = new Cooldown(300_000, () => t);
    expect(c.try('u1:c1')).toBe(true);
    t = 299_000;
    expect(c.try('u1:c1')).toBe(false);
    t = 301_000;
    expect(c.try('u1:c1')).toBe(true);
  });
});
