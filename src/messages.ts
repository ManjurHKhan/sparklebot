import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeText, isSafe, trusted, type SafeText } from './framework/safe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Personality {
  encouragement: string[];
  selfSparkleShame: string[];
  botSparkleQuips: string[];
  firstSparkleCelebration: string[];
  partyAnnouncements: string[];
}

function loadPersonality(name: string): Personality {
  const filePath = join(__dirname, 'personalities', `${name}.json`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Personality;
  } catch {
    if (name === 'playful') throw new Error('Default personality playful.json missing');
    return loadPersonality('playful');
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type MessageVars = Record<string, SafeText | string | number>;

/**
 * Substitute {vars} into a trusted template. Raw strings are escaped; SafeText passes through.
 * Safe by composition: template is repo-authored JSON (trusted by definition), and every var is
 * escaped here or already SafeText — so the trusted() contract holds for the composed result.
 */
function substitute(template: string, vars: MessageVars): SafeText {
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) return `{${key}}`;
    if (typeof v === 'number') return String(v);
    if (isSafe(v)) return v.text;
    return escapeText(v);
  });
  return trusted(text);
}

export interface Messages {
  encouragement(vars: MessageVars): SafeText;
  selfSparkleShame(vars: MessageVars): SafeText;
  botSparkleQuip(vars: MessageVars): SafeText;
  firstSparkleCelebration(vars: MessageVars): SafeText;
  partyAnnouncement(vars: MessageVars): SafeText;
}

export function createMessages(personalityName: string): Messages {
  const p = loadPersonality(personalityName);
  return {
    encouragement: (v) => substitute(pickRandom(p.encouragement), v),
    selfSparkleShame: (v) => substitute(pickRandom(p.selfSparkleShame), v),
    botSparkleQuip: (v) => substitute(pickRandom(p.botSparkleQuips), v),
    firstSparkleCelebration: (v) => substitute(pickRandom(p.firstSparkleCelebration), v),
    partyAnnouncement: (v) => substitute(pickRandom(p.partyAnnouncements), v),
  };
}
