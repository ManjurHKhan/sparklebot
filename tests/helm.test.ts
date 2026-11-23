import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CHART = join(__dirname, '..', 'helm', 'sparklebot');

function helmAvailable(): boolean {
  try {
    execFileSync('helm', ['version', '--short'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function render(extraArgs: string[] = []): string {
  return execFileSync('helm', ['template', 'test', CHART, ...extraArgs], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Codex findings: the chart said one replica but nothing enforced it, and the default
// RollingUpdate strategy briefly runs two pods — two Socket Mode consumers and two
// SQLite writers against the same PVC. Recreate + a hard template guard close both.
describe.skipIf(!helmAvailable())('helm chart single-writer guarantees', () => {
  it('uses Recreate strategy so old and new pods never overlap', () => {
    const out = render();
    expect(out).toMatch(/strategy:\s*\n\s*type:\s*Recreate/);
  });

  it('refuses to render with more than one replica', () => {
    expect(() => render(['--set', 'replicaCount=2'])).toThrow(/replica/i);
  });

  it('renders fine with the default single replica', () => {
    expect(render()).toContain('replicas: 1');
  });

  it('exposes throttle knobs and drops the unused SPARKLE_EMOJI', () => {
    const out = render();
    expect(out).toContain('SPARKLE_RATE_LIMIT');
    expect(out).toContain('SPARKLE_CMD_LIMIT');
    expect(out).not.toContain('SPARKLE_EMOJI');
  });

  it('renders the welcome, tour, mega emoji and suggest settings', () => {
    const tour = [{ id: 'C0FAKE0002', about: `say "hi" \\ it's café <&>` }];
    const out = render([
      '--set', 'sparkle.welcomeChannel=C0FAKE0001',
      '--set', 'sparkle.suggestTo=U0FAKE0001',
      '--set', 'sparkle.megaEmoji=:boom:',
      '--set-json', `sparkle.welcomeChannels=${JSON.stringify(tour)}`,
    ]);
    // YAML double-quoted scalar holding JSON: parse the scalar, then the JSON.
    const raw = out.match(/^\s*SPARKLE_WELCOME_CHANNELS: (".*")$/m)?.[1];
    expect(raw).toBeDefined();
    expect(JSON.parse(JSON.parse(raw!))).toEqual(tour);
    expect(out).toContain('SPARKLE_WELCOME_CHANNEL: "C0FAKE0001"');
    expect(out).toContain('SPARKLE_SUGGEST_TO: "U0FAKE0001"');
    expect(out).toContain('SPARKLE_MEGA_EMOJI: ":boom:"');
  });

  it('rolls the pod when only the ConfigMap changes', () => {
    const sum = (args: string[]) => render(args).match(/checksum\/config: (\w+)/)?.[1];
    const a = sum(['--set', 'sparkle.welcomeChannel=C0FAKE0001']);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sum(['--set', 'sparkle.welcomeChannel=C0FAKE0001'])).toBe(a);
    expect(sum(['--set', 'sparkle.welcomeChannel=C0FAKE0002'])).not.toBe(a);
  });

  it('defaults leave every new feature off', () => {
    const out = render();
    expect(out).toContain('SPARKLE_WELCOME_CHANNEL: ""');
    expect(out).toContain('SPARKLE_WELCOME_CHANNELS: "[]"');
    expect(out).toContain('SPARKLE_SUGGEST_TO: ""');
    expect(out).toContain('SPARKLE_MEGA_EMOJI: ""');
  });

  it('renders SPARKLE_MESSAGES as JSON, {} by default', () => {
    const out = render(['--set-json', 'sparkle.messages={"agentNudge":["hi {user}"]}']);
    expect(out).toContain('SPARKLE_MESSAGES: "{\\"agentNudge\\":[\\"hi {user}\\"]}"');
    expect(render()).toContain('SPARKLE_MESSAGES: "{}"');
  });
});
