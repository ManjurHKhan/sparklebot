import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPersonality(name) {
  const filePath = join(__dirname, 'personalities', `${name}.json`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    if (name === 'playful') throw new Error('Default personality playful.json missing');
    return loadPersonality('playful');
  }
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function substitute(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{${key}}`));
}

export function createMessages(personalityName) {
  const personality = loadPersonality(personalityName);

  return {
    encouragement(vars) {
      return substitute(pickRandom(personality.encouragement), vars);
    },
    selfSparkleShame(vars) {
      return substitute(pickRandom(personality.selfSparkleShame), vars);
    },
    botSparkleQuip(vars) {
      return substitute(pickRandom(personality.botSparkleQuips), vars);
    },
    firstSparkleCelebration(vars) {
      return substitute(pickRandom(personality.firstSparkleCelebration), vars);
    },
    partyAnnouncement(vars) {
      return substitute(pickRandom(personality.partyAnnouncements), vars);
    },
  };
}
