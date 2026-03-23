import { describe, it, expect } from 'vitest';
import { parseSparkleCommand, tierEmoji } from '../../src/handlers/sparkle.js';

describe('parseSparkleCommand', () => {
  it('parses single mention with reason', () => {
    const result = parseSparkleCommand('.sparkle <@U123> great work');
    expect(result.targets).toEqual([{ id: 'U123', raw: '<@U123>' }]);
    expect(result.reason).toBe('great work');
    expect(result.isParty).toBe(false);
  });

  it('parses multiple mentions with reason', () => {
    const result = parseSparkleCommand('.sparkle <@U1> <@U2> <@U3> nice job');
    expect(result.targets).toHaveLength(3);
    expect(result.targets[0].id).toBe('U1');
    expect(result.targets[1].id).toBe('U2');
    expect(result.targets[2].id).toBe('U3');
    expect(result.reason).toBe('nice job');
  });

  it('parses multiple mentions with no reason', () => {
    const result = parseSparkleCommand('.sparkle <@U1> <@U2>');
    expect(result.targets).toHaveLength(2);
    expect(result.reason).toBe(null);
  });

  it('parses plain text target with reason', () => {
    const result = parseSparkleCommand('.sparkle bob for being awesome');
    expect(result.targets).toEqual([{ id: null, raw: 'bob' }]);
    expect(result.reason).toBe('for being awesome');
  });

  it('parses plain text target with no reason', () => {
    const result = parseSparkleCommand('.sparkle bob');
    expect(result.targets).toEqual([{ id: null, raw: 'bob' }]);
    expect(result.reason).toBe(null);
  });

  it('parses mention with display name format <@U123|alice>', () => {
    const result = parseSparkleCommand('.sparkle <@U123|alice> nice');
    expect(result.targets).toEqual([{ id: 'U123', raw: '<@U123>' }]);
    expect(result.reason).toBe('nice');
  });

  it('parses mention with no reason', () => {
    const result = parseSparkleCommand('.sparkle <@U123>');
    expect(result.targets).toEqual([{ id: 'U123', raw: '<@U123>' }]);
    expect(result.reason).toBe(null);
  });

  it('parses party command', () => {
    const result = parseSparkleCommand('.sparkle party');
    expect(result.isParty).toBe(true);
    expect(result.targets).toEqual([]);
  });

  it('parses party with trailing text as party', () => {
    const result = parseSparkleCommand('.sparkle party time');
    expect(result.isParty).toBe(true);
  });

  it('returns null for non-sparkle messages', () => {
    expect(parseSparkleCommand('hello world')).toBe(null);
    expect(parseSparkleCommand('sparkle someone')).toBe(null);
    expect(parseSparkleCommand('the .sparkle command')).toBe(null);
  });

  it('returns null for .sparkles (leaderboard command)', () => {
    expect(parseSparkleCommand('.sparkles')).toBe(null);
  });

  it('returns null for .sparkle with no arguments', () => {
    expect(parseSparkleCommand('.sparkle ')).toBe(null);
  });

  it('returns null for empty or null text', () => {
    expect(parseSparkleCommand('')).toBe(null);
    expect(parseSparkleCommand(null)).toBe(null);
    expect(parseSparkleCommand(undefined)).toBe(null);
  });

  it('handles extra whitespace', () => {
    const result = parseSparkleCommand('.sparkle   <@U1>   great work  ');
    expect(result.targets[0].id).toBe('U1');
    expect(result.reason).toBe('great work');
  });
});

describe('tierEmoji', () => {
  it('returns :sparkles: for counts below 5', () => {
    expect(tierEmoji(1)).toBe(':sparkles:');
    expect(tierEmoji(4)).toBe(':sparkles:');
  });

  it('returns :star: for counts 5-9', () => {
    expect(tierEmoji(5)).toBe(':star:');
    expect(tierEmoji(9)).toBe(':star:');
  });

  it('returns :sparkle: for counts 10-24', () => {
    expect(tierEmoji(10)).toBe(':sparkle:');
    expect(tierEmoji(24)).toBe(':sparkle:');
  });

  it('returns :dizzy: for counts 25-49', () => {
    expect(tierEmoji(25)).toBe(':dizzy:');
    expect(tierEmoji(49)).toBe(':dizzy:');
  });

  it('returns :star2: for counts 50-99', () => {
    expect(tierEmoji(50)).toBe(':star2:');
    expect(tierEmoji(99)).toBe(':star2:');
  });

  it('returns :gem: for counts 100+', () => {
    expect(tierEmoji(100)).toBe(':gem:');
    expect(tierEmoji(500)).toBe(':gem:');
  });
});
