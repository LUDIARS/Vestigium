/**
 * JSONL writer (per-service)。
 *
 * - 日付境界 (UTC) で出力先 file を切替
 * - write は append (createWriteStream(flags='a'))
 * - 失敗は process.stderr に warning を出すだけで投げない (サービス本体を落とさない)
 */

import fs from 'node:fs';
import { dayFile, serviceDir, ymdUtc, resolveLogsDir } from './util/paths.js';
import { serialize, type Channel, type LogLevel, type LogRecord } from './util/jsonl.js';

export interface WriterOptions {
  serviceCode: string;
  logsDir?: string;
}

export interface WriteInput {
  level?: LogLevel;
  msg: string;
  channel?: Channel;
  ts?: number;
  ctx?: Record<string, unknown>;
  pid?: number;
}

export interface Writer {
  readonly serviceCode: string;
  readonly logsDir: string;
  currentFile(): string;
  write(input: WriteInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function createWriter(opts: WriterOptions): Writer {
  const serviceCode = opts.serviceCode;
  const logsDir = resolveLogsDir(opts.logsDir);
  fs.mkdirSync(serviceDir(logsDir, serviceCode), { recursive: true });

  let currentYmd = ymdUtc(new Date());
  let stream: fs.WriteStream | null = openStream(logsDir, serviceCode, new Date());
  let closed = false;

  function ensureCurrent(now: Date): fs.WriteStream {
    const ymd = ymdUtc(now);
    if (ymd !== currentYmd || stream === null) {
      try { stream?.end(); } catch { /* noop */ }
      stream = openStream(logsDir, serviceCode, now);
      currentYmd = ymd;
    }
    return stream;
  }

  return {
    serviceCode,
    logsDir,
    currentFile() {
      return dayFile(logsDir, serviceCode, new Date());
    },
    write(input: WriteInput) {
      if (closed) return;
      const now = new Date(input.ts ?? Date.now());
      const rec: LogRecord = {
        ts: now.getTime(),
        level: input.level ?? 'info',
        service: serviceCode,
        channel: input.channel ?? 'app',
        msg: input.msg,
        pid: input.pid ?? process.pid,
        ctx: input.ctx,
      };
      const line = serialize(rec);
      try {
        const s = ensureCurrent(now);
        s.write(line);
      } catch (err) {
        warn(`write failed: ${(err as Error).message}`);
      }
    },
    async flush() {
      // WriteStream は flush API がない (drain で代用)。 ここでは noop。
      // close 時にバッファは flush される。
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        if (!stream) return resolve();
        stream.end(() => resolve());
      });
      stream = null;
    },
  };
}

function openStream(logsDir: string, serviceCode: string, when: Date): fs.WriteStream {
  fs.mkdirSync(serviceDir(logsDir, serviceCode), { recursive: true });
  const file = dayFile(logsDir, serviceCode, when);
  return fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
}

function warn(msg: string): void {
  try {
    process.stderr.write(`[vestigium] ${msg}\n`);
  } catch { /* swallow */ }
}
