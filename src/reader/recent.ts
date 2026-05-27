/**
 * service 単位で直近 N 行を読む / regex 検索する / error level 抽出。
 * MCP server / CLI tail から共通で使う read 側 API。
 */

import fs from 'node:fs';
import { listServiceFiles } from './tail.js';
import { parse, type LogRecord } from '../util/jsonl.js';
import { resolveLogsDir, serviceDir } from '../util/paths.js';

export interface RecentOptions {
  serviceCode: string;
  logsDir?: string;
  limit?: number;
  level?: LogRecord['level'][];
  since?: number; // epoch ms
}

/** 新しい順に最大 limit 行を返す (順序は ts 降順) */
export function recent(opts: RecentOptions): LogRecord[] {
  const logsDir = resolveLogsDir(opts.logsDir);
  const limit = opts.limit ?? 200;
  const collected: LogRecord[] = [];
  const files = listServiceFiles(logsDir, opts.serviceCode); // 新しい順
  for (const file of files) {
    const lines = readLinesReverse(file);
    for (const line of lines) {
      const rec = parse(line);
      if (!rec) continue;
      if (opts.level && !opts.level.includes(rec.level)) continue;
      if (opts.since !== undefined && rec.ts < opts.since) return collected;
      collected.push(rec);
      if (collected.length >= limit) return collected;
    }
  }
  return collected;
}

export interface SearchOptions {
  serviceCodes: string[];
  logsDir?: string;
  pattern: string | RegExp;
  limit?: number;
  since?: number;
}

export function search(opts: SearchOptions): LogRecord[] {
  const re = typeof opts.pattern === 'string'
    ? new RegExp(opts.pattern, 'i')
    : opts.pattern;
  const limit = opts.limit ?? 200;
  const all: LogRecord[] = [];
  for (const code of opts.serviceCodes) {
    const hits = recent({
      serviceCode: code,
      logsDir: opts.logsDir,
      limit: 5000,
      since: opts.since,
    }).filter((r) => re.test(r.msg));
    for (const h of hits) all.push(h);
  }
  all.sort((a, b) => b.ts - a.ts);
  return all.slice(0, limit);
}

export function listServices(logsDir?: string): string[] {
  const dir = resolveLogsDir(logsDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function lastSeenAt(serviceCode: string, logsDir?: string): number | null {
  const files = listServiceFiles(resolveLogsDir(logsDir), serviceCode);
  if (files.length === 0) return null;
  // 最新 file の最後の line の ts を取る
  const last = readLinesReverse(files[0]!).find((l) => parse(l) !== null);
  if (!last) return null;
  return parse(last)?.ts ?? null;
}

/** 末尾から行単位に読む (大きい file には不向き、 末尾 256KB だけ読む簡易版) */
function readLinesReverse(file: string): string[] {
  const stat = fs.statSync(file);
  const readBytes = Math.min(stat.size, 256 * 1024);
  const offset = stat.size - readBytes;
  const buffer = Buffer.alloc(readBytes);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, readBytes, offset);
  } finally {
    fs.closeSync(fd);
  }
  // 先頭が中途半端な行になる可能性: offset > 0 なら最初の line は捨てる
  const lines = buffer.toString('utf8').split('\n');
  if (offset > 0 && lines.length > 0) lines.shift();
  return lines.filter((l) => l.length > 0).reverse();
}

export function serviceDirExists(serviceCode: string, logsDir?: string): boolean {
  return fs.existsSync(serviceDir(resolveLogsDir(logsDir), serviceCode));
}
