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
});
