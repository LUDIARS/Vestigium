import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWriter } from './writer.js';
import { dayFile, tempLogsDir, ymdUtc, serviceDir } from './util/paths.js';
import { parse } from './util/jsonl.js';

const dirs: string[] = [];
function makeDir(): string {
  const d = tempLogsDir();
  fs.mkdirSync(d, { recursive: true });
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
  dirs.length = 0;
});

describe('writer', () => {
  it('appends a JSON line per write to today file', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc-a', logsDir });
    w.write({ level: 'info', msg: 'first' });
    w.write({ level: 'error', msg: 'second' });
    await w.close();

    const file = dayFile(logsDir, 'svc-a');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(parse(lines[0]!)?.msg).toBe('first');
    expect(parse(lines[1]!)?.level).toBe('error');
  });

  it('rolls to a new file when day boundary crossed', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc-a', logsDir });
    // simulate yesterday by writing with past ts
    const yesterday = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    w.write({ msg: 'past', ts: yesterday.getTime() });
    const today = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
    w.write({ msg: 'today', ts: today.getTime() });
    await w.close();

    const dir = serviceDir(logsDir, 'svc-a');
    const files = fs.readdirSync(dir).sort();
    expect(files).toContain('2026-01-01.jsonl');
    expect(files).toContain('2026-01-02.jsonl');
  });

  it('sanitizes service code (rejects bad chars)', () => {
    const logsDir = makeDir();
    expect(() => createWriter({ serviceCode: 'svc/bad', logsDir }))
      .toThrow();
  });

  it('write after close is silently dropped', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc-a', logsDir });
    w.write({ msg: 'before' });
    await w.close();
    expect(() => w.write({ msg: 'after' })).not.toThrow();
  });

  it('day-rolled output reflects current UTC date', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc-a', logsDir });
    w.write({ msg: 'hi' });
    await w.close();
    expect(fs.existsSync(path.join(serviceDir(logsDir, 'svc-a'), `${ymdUtc(new Date())}.jsonl`))).toBe(true);
  });
});
