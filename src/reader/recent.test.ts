import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { createWriter } from '../writer.js';
import { recent, search, listServices } from './recent.js';
import { tempLogsDir } from '../util/paths.js';

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

describe('reader/recent', () => {
  it('returns most-recent first, respecting limit', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc', logsDir });
    w.write({ msg: 'one' });
    w.write({ msg: 'two' });
    w.write({ msg: 'three' });
    await w.close();

    const r = recent({ serviceCode: 'svc', logsDir, limit: 2 });
    expect(r.length).toBe(2);
    expect(r[0]?.msg).toBe('three');
    expect(r[1]?.msg).toBe('two');
  });

  it('filters by level', async () => {
    const logsDir = makeDir();
    const w = createWriter({ serviceCode: 'svc', logsDir });
    w.write({ msg: 'a', level: 'info' });
    w.write({ msg: 'b', level: 'error' });
    w.write({ msg: 'c', level: 'warn' });
    await w.close();

    const r = recent({ serviceCode: 'svc', logsDir, limit: 10, level: ['error', 'warn'] });
    expect(r.map((x) => x.msg).sort()).toEqual(['b', 'c']);
  });

  it('search filters cross-service by regex', async () => {
    const logsDir = makeDir();
    const a = createWriter({ serviceCode: 'a', logsDir });
    const b = createWriter({ serviceCode: 'b', logsDir });
    a.write({ msg: 'apple pie' });
    a.write({ msg: 'banana' });
    b.write({ msg: 'apple sauce' });
    await a.close();
    await b.close();

    const hits = search({ serviceCodes: ['a', 'b'], logsDir, pattern: 'apple' });
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.msg).toMatch(/apple/);
  });

  it('listServices enumerates service dirs', async () => {
    const logsDir = makeDir();
    const a = createWriter({ serviceCode: 'aa', logsDir });
    a.write({ msg: 'x' });
    await a.close();
    const b = createWriter({ serviceCode: 'bb', logsDir });
    b.write({ msg: 'y' });
    await b.close();
    expect(listServices(logsDir).sort()).toEqual(['aa', 'bb']);
  });
});
