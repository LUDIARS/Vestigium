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

describe('writer: 書き込み失敗でサービスを落とさない', () => {
  it("stream の 'error' で uncaught exception にしない", async () => {
    // WriteStream の失敗は同期例外ではなく 'error' イベントで来る。 ハンドラが無いと
    // Node は uncaught exception にしてプロセスを落とす — write() を try で囲んでも
    // 守れない。 Windows では他プロセスが同じ日付ファイルを掴むと EPERM になり、
    // 並行する委託が着手前に死んでいた (Memoria #2030)。
    //
    // 再現: 出力先の *ファイル名* をディレクトリにしておく。 serviceDir の mkdir は
    // 通り、 createWriteStream が EISDIR を 'error' で投げる。
    const logsDir = makeDir();
    const writer = createWriter({ serviceCode: 'test-svc', logsDir });
    const file = writer.currentFile();
    await writer.close();
    fs.rmSync(file, { force: true });
    fs.mkdirSync(file, { recursive: true });

    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => { uncaught.push(err); };
    process.on('uncaughtException', onUncaught);
    try {
      const blocked = createWriter({ serviceCode: 'test-svc', logsDir });
      expect(() => blocked.write({ msg: 'dropped' })).not.toThrow();
      // 'error' は非同期に届く。 イベントループを 1 周させてから確かめる。
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toEqual([]);
      await blocked.close();
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('出力先が開けなくても write / close が投げない', async () => {
    // ログが取れないことと、 サービスが動かないことは別 (module header の方針)。
    const base = makeDir();
    const logsDir = path.join(base, 'occupied');
    fs.writeFileSync(logsDir, 'not a directory', 'utf8');

    const writer = createWriter({ serviceCode: 'test-svc', logsDir });
    expect(() => writer.write({ msg: 'dropped' })).not.toThrow();
    await expect(writer.close()).resolves.toBeUndefined();
  });

  it('出力先が復旧したら次の write で書き直す', async () => {
    // 「次の write で再試行する」が本 PR の要件。 開けない状態で write しても
    // 終了済み stream を残さず、 復旧後の write が実際に file へ届くことを見る。
    const base = makeDir();
    const logsDir = path.join(base, 'occupied');
    fs.writeFileSync(logsDir, 'not a directory', 'utf8');

    const writer = createWriter({ serviceCode: 'test-svc', logsDir });
    expect(() => writer.write({ msg: 'dropped' })).not.toThrow();

    // 障害を取り除く — 以降は普通に開けるはず。
    fs.rmSync(logsDir, { force: true });
    expect(() => writer.write({ msg: 'recovered' })).not.toThrow();
    await writer.close();

    const file = dayFile(logsDir, 'test-svc');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.map((l) => parse(l)?.msg)).toEqual(['recovered']);
  });
});
