import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeText, isSafe, trusted, type SafeText } from './framework/safe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MESSAGE_KEYS = [
  'encouragement', 'selfSparkleShame', 'botSparkleQuips', 'firstSparkleCelebration', 'partyAnnouncements',
  'welcomePublic', 'welcomeDM', 'firstGiveBonus', 'agentNudge',
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];
/** Operator-supplied replacement lists (SPARKLE_MESSAGES). Untrusted: sanitised before use. */
export type MessageOverrides = Partial<Record<MessageKey, string[]>>;

type Personality = Record<MessageKey, string[]>;

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
 * Safe by composition: template is repo-authored JSON or a cleanTemplate'd override, and every var is
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
  welcomePublic(vars: MessageVars): SafeText;
  welcomeDM(vars: MessageVars): SafeText;
  firstGiveBonus(vars: MessageVars): SafeText;
  agentNudge(vars: MessageVars): SafeText;
}

/**
 * Operator lines skip repo review. Every Slack ping or link is a <…> sequence, so escaping
 * & and < leaves them as plain text while *bold*, emoji and > quotes still render.
 */
function cleanTemplate(line: string): string {
  return line.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

export function createMessages(personalityName: string, overrides: MessageOverrides = {}): Messages {
  const cleaned = Object.fromEntries(Object.entries(overrides).map(([k, lines]) => [k, lines.map(cleanTemplate)]));
  const p: Personality = { ...loadPersonality(personalityName), ...cleaned };
  return {
    encouragement: (v) => substitute(pickRandom(p.encouragement), v),
    selfSparkleShame: (v) => substitute(pickRandom(p.selfSparkleShame), v),
    botSparkleQuip: (v) => substitute(pickRandom(p.botSparkleQuips), v),
    firstSparkleCelebration: (v) => substitute(pickRandom(p.firstSparkleCelebration), v),
    partyAnnouncement: (v) => substitute(pickRandom(p.partyAnnouncements), v),
    welcomePublic: (v) => substitute(pickRandom(p.welcomePublic), v),
    welcomeDM: (v) => substitute(pickRandom(p.welcomeDM), v),
    firstGiveBonus: (v) => substitute(pickRandom(p.firstGiveBonus), v),
    agentNudge: (v) => substitute(pickRandom(p.agentNudge), v),
  };
}
