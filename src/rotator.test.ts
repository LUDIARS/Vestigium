import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sweep, startSweeper } from './rotator.js';
import { tempLogsDir, ymdUtc } from './util/paths.js';

const dirs: string[] = [];
function makeDir(): string {
  const d = tempLogsDir();
  fs.mkdirSync(d, { recursive: true });
  dirs.push(d);
  return d;
}
function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n');
}

afterEach(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
  dirs.length = 0;
});

describe('rotator.sweep', () => {
  it('removes files older than retentionDays, keeps recent + today', () => {
    const logsDir = makeDir();
    const dir = path.join(logsDir, 'svc');
    const today = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    touch(path.join(dir, '2026-05-01.jsonl')); // 31 days old → remove
    touch(path.join(dir, '2026-05-25.jsonl')); // 7 days old → keep (retention 14)
    touch(path.join(dir, '2026-06-01.jsonl')); // today → keep
    touch(path.join(dir, 'not-a-log.txt'));    // ignored

    const r = sweep({ logsDir, retentionDays: 14, now: today });
    expect(r.removed.length).toBe(1);
    expect(r.removed[0]).toContain('2026-05-01.jsonl');
    expect(fs.existsSync(path.join(dir, '2026-05-25.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '2026-06-01.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'not-a-log.txt'))).toBe(true);
  });

  it('retentionDays=0 is a no-op', () => {
    const logsDir = makeDir();
    const dir = path.join(logsDir, 'svc');
    touch(path.join(dir, '2020-01-01.jsonl'));
    const r = sweep({ logsDir, retentionDays: 0 });
    expect(r.removed.length).toBe(0);
    expect(fs.existsSync(path.join(dir, '2020-01-01.jsonl'))).toBe(true);
  });

  it('dryRun lists candidates without deleting', () => {
    const logsDir = makeDir();
    const dir = path.join(logsDir, 'svc');
    touch(path.join(dir, '2020-01-01.jsonl'));
    const r = sweep({ logsDir, retentionDays: 14, dryRun: true });
    expect(r.removed.length).toBe(1);
    expect(fs.existsSync(path.join(dir, '2020-01-01.jsonl'))).toBe(true);
  });

  it('scoped to services list when provided', () => {
    const logsDir = makeDir();
    touch(path.join(logsDir, 'a', '2020-01-01.jsonl'));
    touch(path.join(logsDir, 'b', '2020-01-01.jsonl'));
    const r = sweep({ logsDir, retentionDays: 14, services: ['a'] });
    expect(r.removed.length).toBe(1);
    expect(r.removed[0]).toContain(path.join('a', '2020-01-01.jsonl'));
    expect(fs.existsSync(path.join(logsDir, 'b', '2020-01-01.jsonl'))).toBe(true);
  });

  it('startSweeper with retention=0 returns no-op handle', () => {
    const handle = startSweeper({ retentionDays: 0, intervalMs: 100 });
    expect(() => handle.stop()).not.toThrow();
  });

  it("doesn't delete today file even if retentionDays is small", () => {
    const logsDir = makeDir();
    const dir = path.join(logsDir, 'svc');
    const now = new Date();
    const todayFile = path.join(dir, `${ymdUtc(now)}.jsonl`);
    touch(todayFile);
    const r = sweep({ logsDir, retentionDays: 1, now });
    expect(r.removed).not.toContain(todayFile);
    expect(fs.existsSync(todayFile)).toBe(true);
  });
});
