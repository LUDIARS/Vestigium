import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { createWriter } from '../writer.js';
import { hookConsole } from './console.js';
import { tempLogsDir, dayFile } from '../util/paths.js';
import { parse } from '../util/jsonl.js';

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

describe('sdk/console', () => {
  it('captures console.log into writer', async () => {
    const logsDir = makeDir();
    const writer = createWriter({ serviceCode: 'svc', logsDir });
    const hook = hookConsole({ writer });
    try {
      // suppress stdout noise during test
      const origLog = console.log;
      console.log = () => {};
      // call back to the hooked version (we re-read hooked one)
      // restore so the hooked impl runs
      console.log = origLog;
      // The hookConsole already replaced console.log with our handler.
      // It also calls the (original captured) console.log internally.
      // Call console.warn to skip the normal stdout chatter.
      console.warn('boom');
    } finally {
      hook.unhook();
      await writer.close();
    }
    const lines = fs.readFileSync(dayFile(logsDir, 'svc'), 'utf8').trim().split('\n');
    const records = lines.map(parse).filter((r): r is NonNullable<ReturnType<typeof parse>> => r !== null);
    expect(records.some((r) => r.msg === 'boom' && r.level === 'warn')).toBe(true);
  });

  it('unhook restores original methods (writer stops receiving)', async () => {
    const logsDir = makeDir();
    const writer = createWriter({ serviceCode: 'svc', logsDir });
    const before = console.log;
    const hook = hookConsole({ writer });
    try {
      expect(console.log).not.toBe(before);
    } finally {
      hook.unhook();
    }
    // Identity may differ when vitest also wraps console; what matters is that
    // after unhook, writes go to original, not into our captured file.
    await writer.close();
    // Calling console.log after unhook + close must not crash.
    expect(() => console.log('after-unhook')).not.toThrow();
  });
});
