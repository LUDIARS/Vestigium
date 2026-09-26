import { describe, it, expect, afterEach, vi } from 'vitest';
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


/** Hold one real file open operation while all other WriteStreams use the real filesystem. */
function gateFileOpen(fileName: string) {
  const createStream = fs.createWriteStream;
  const realOpen = fs.open;
  const streams: { file: string; stream: fs.WriteStream; closed: Promise<void> }[] = [];
  let openRequested!: () => void;
  const requested = new Promise<void>((resolve) => { openRequested = resolve; });
  let continueOpen: (() => void) | undefined;
  let released = false;
  let failure: NodeJS.ErrnoException | undefined;
  const spy = vi.spyOn(fs, 'createWriteStream').mockImplementation((file, options) => {
    const gated = path.basename(String(file)) === fileName;
    const settings = typeof options === 'string' ? { encoding: options } : options;
    const stream = gated ? createStream(file, {
      ...settings,
      fs: {
        open(target: fs.PathLike, flags: fs.OpenMode, mode: fs.Mode,
          callback: (error: NodeJS.ErrnoException | null, fd: number) => void): void {
          continueOpen = () => {
            if (failure) callback(failure, -1);
            else realOpen(target, flags, mode, callback);
          };
          openRequested();
          if (released) continueOpen();
        },
        write: fs.write,
        writev: fs.writev,
        close: fs.close,
      },
    }) : createStream(file, options);
    const closed = new Promise<void>((resolve) => { stream.once('close', resolve); });
    streams.push({ file: path.basename(String(file)), stream, closed });
    return stream;
  });
  return {
    requested,
    streams,
    release(error?: NodeJS.ErrnoException): void {
      if (released) return;
      released = true;
      failure = error;
      continueOpen?.();
    },
    restore(): void { spy.mockRestore(); },
  };
}

function streamFor(gate: ReturnType<typeof gateFileOpen>, file: string) {
  const entry = gate.streams.filter((item) => item.file === file).at(-1);
  if (!entry) throw new Error('Expected stream was not created: ' + file);
  return entry;
}

function fileMessages(logsDir: string, file: string): string[] {
  return fs.readFileSync(path.join(serviceDir(logsDir, 'drain-svc'), file), 'utf8')
    .trim().split('\n').map((line) => parse(line)?.msg ?? 'invalid JSON record');
}

describe('writer: all owned streams drain before close resolves', () => {
  it('waits for an old pending open even after the latest stream closes, including repeated close calls', async () => {
    const logsDir = makeDir();
    const gate = gateFileOpen('2026-01-01.jsonl');
    const writer = createWriter({ serviceCode: 'drain-svc', logsDir });
    try {
      writer.write({ msg: 'past-first', ts: Date.UTC(2026, 0, 1, 12) });
      writer.write({ msg: 'past-second', ts: Date.UTC(2026, 0, 1, 13) });
      writer.write({ msg: 'today', ts: Date.UTC(2026, 0, 2, 12) });
      const latest = streamFor(gate, '2026-01-02.jsonl');
      let firstClosed = false;
      let secondClosed = false;
      const firstClose = writer.close().then(() => { firstClosed = true; });
      const secondClose = writer.close().then(() => { secondClosed = true; });
      // This event barrier proves the newer stream has completed; no timing sleep is involved.
      await Promise.all([gate.requested, latest.closed]);
      await Promise.resolve();
      expect(firstClosed).toBe(false);
      expect(secondClosed).toBe(false);
      gate.release();
      await Promise.all([firstClose, secondClose]);
      expect(gate.streams.every((entry) => entry.stream.closed)).toBe(true);
      expect(fileMessages(logsDir, '2026-01-01.jsonl')).toEqual(['past-first', 'past-second']);
      expect(fileMessages(logsDir, '2026-01-02.jsonl')).toEqual(['today']);
    } finally {
      gate.release();
      try {
        await writer.close();
        // Cleanup also drains streams on a regression where writer.close() returned prematurely.
        await Promise.all(gate.streams.map((entry) => entry.closed));
      } finally { gate.restore(); }
    }
  });

  it('settles a failed retired open without discarding or reopening the healthy current stream', async () => {
    const logsDir = makeDir();
    const gate = gateFileOpen('2026-01-01.jsonl');
    const writer = createWriter({ serviceCode: 'drain-svc', logsDir });
    try {
      writer.write({ msg: 'cannot-be-written', ts: Date.UTC(2026, 0, 1, 12) });
      writer.write({ msg: 'before-old-error', ts: Date.UTC(2026, 0, 2, 12) });
      const old = streamFor(gate, '2026-01-01.jsonl');
      const latest = streamFor(gate, '2026-01-02.jsonl');
      const latestCount = gate.streams.filter((entry) => entry.file === latest.file).length;
      await gate.requested;
      gate.release(Object.assign(new Error('controlled retired open failure'), { code: 'EACCES' }));
      await old.closed;
      writer.write({ msg: 'after-old-error', ts: Date.UTC(2026, 0, 2, 13) });
      expect(gate.streams.filter((entry) => entry.file === latest.file)).toHaveLength(latestCount);
      await Promise.all([writer.close(), writer.close()]);
      expect(gate.streams.every((entry) => entry.stream.closed)).toBe(true);
      expect(fileMessages(logsDir, '2026-01-02.jsonl')).toEqual(['before-old-error', 'after-old-error']);
      expect(fs.existsSync(path.join(serviceDir(logsDir, 'drain-svc'), '2026-01-01.jsonl'))).toBe(false);
    } finally {
      gate.release();
      try {
        await writer.close();
        await Promise.all(gate.streams.map((entry) => entry.closed));
      } finally { gate.restore(); }
    }
  });
});
