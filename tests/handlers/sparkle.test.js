import { describe, it, expect } from 'vitest';
import { parseSparkleCommand } from '../../src/handlers/sparkle.js';

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
    expect(result.reason).toBe('nice job');
  });

  it('parses plain text target', () => {
    const result = parseSparkleCommand('.sparkle bob for being awesome');
    expect(result.targets).toEqual([{ id: null, raw: 'bob' }]);
    expect(result.reason).toBe('for being awesome');
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

  it('returns null for non-sparkle messages', () => {
    expect(parseSparkleCommand('hello world')).toBe(null);
    expect(parseSparkleCommand('.sparkles')).toBe(null);
  });
});
