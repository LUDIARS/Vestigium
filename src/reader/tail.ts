/**
 * file-tail reader — 当日 jsonl を tail し、 日付境界で次 file へ自動切替。
 * Concordia の file-tail bridge から呼ぶ想定だが、 Vestigium 単独でも使える。
 */

import fs from 'node:fs';
import path from 'node:path';
import { dayFile, serviceDir, ymdUtc, resolveLogsDir } from '../util/paths.js';
import { parse, type LogRecord } from '../util/jsonl.js';

export interface TailOptions {
  serviceCode: string;
  logsDir?: string;
  /** 起動時に直近 N 行を flush してから follow に入る (default 0) */
  fromTail?: number;
  /** file をまだ読み始める前に既存内容を全 emit するか (default false) */
  fromBeginning?: boolean;
  /** polling 間隔 (ms)。 fs.watch 取りこぼし対策の fallback。 default 1000ms */
  pollIntervalMs?: number;
  onLine: (rec: LogRecord) => void;
  onError?: (err: Error) => void;
}

export interface TailHandle {
  stop(): void;
}

export function tailService(opts: TailOptions): TailHandle {
  const logsDir = resolveLogsDir(opts.logsDir);
  const dir = serviceDir(logsDir, opts.serviceCode);
  fs.mkdirSync(dir, { recursive: true });

  let currentYmd = ymdUtc(new Date());
  let currentFile = dayFile(logsDir, opts.serviceCode, new Date());
  let offset = 0;
  let stopped = false;
  let buf = '';
  let timer: NodeJS.Timeout | null = null;

  const initialEmit = () => {
    if (!fs.existsSync(currentFile)) return;
    const size = fs.statSync(currentFile).size;
    if (opts.fromBeginning) {
      offset = 0;
    } else if (opts.fromTail && opts.fromTail > 0) {
      // 単純化: 末尾 N KB から読んで line N 個を保持
      const readBytes = Math.min(size, opts.fromTail * 4 * 1024);
      offset = Math.max(0, size - readBytes);
      const fd = fs.openSync(currentFile, 'r');
      try {
        const buffer = Buffer.alloc(readBytes);
        fs.readSync(fd, buffer, 0, readBytes, offset);
        const lines = buffer.toString('utf8').split('\n').filter(Boolean);
        const tail = lines.slice(-opts.fromTail);
        for (const l of tail) {
          const rec = parse(l);
          if (rec) opts.onLine(rec);
        }
        offset = size;
      } finally {
        fs.closeSync(fd);
      }
    } else {
      offset = size;
    }
  };

  const drain = () => {
    if (stopped) return;
    try {
      const today = ymdUtc(new Date());
      if (today !== currentYmd) {
        // 日付境界: 旧 file の残り flush → 新 file へ
        readMore();
        currentYmd = today;
        currentFile = dayFile(logsDir, opts.serviceCode, new Date());
        offset = 0;
        buf = '';
      }
      readMore();
    } catch (err) {
      opts.onError?.(err as Error);
    }
  };

  const readMore = () => {
    if (!fs.existsSync(currentFile)) return;
    const stat = fs.statSync(currentFile);
    if (stat.size < offset) {
      // truncated / rotated mid-day。 offset reset
      offset = 0;
      buf = '';
    }
    if (stat.size === offset) return;
    const fd = fs.openSync(currentFile, 'r');
    try {
      const need = stat.size - offset;
      const buffer = Buffer.alloc(need);
      fs.readSync(fd, buffer, 0, need, offset);
      offset = stat.size;
      buf += buffer.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const rec = parse(line);
        if (rec) opts.onLine(rec);
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  initialEmit();
  timer = setInterval(drain, opts.pollIntervalMs ?? 1000);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** dir 直下の YYYY-MM-DD.jsonl を最新順に列挙 */
export function listServiceFiles(logsDir: string, serviceCode: string): string[] {
  const dir = serviceDir(logsDir, serviceCode);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .reverse()
    .map((f) => path.join(dir, f));
}
