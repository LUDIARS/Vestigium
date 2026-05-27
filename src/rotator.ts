/**
 * retention sweeper — `<logsDir>/<service>/YYYY-MM-DD.jsonl[.gz]` のうち、
 * UTC 基準で `retentionDays` を過ぎたものを削除する。
 *
 * - retentionDays = 0 で sweep 無効
 * - 当日 file は常に保護
 * - service dir 配下のみ touch (logsDir 直下の他 file は触らない)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseYmd, ymdUtc, resolveLogsDir } from './util/paths.js';

export interface SweepOptions {
  logsDir?: string;
  retentionDays: number;
  /** 対象 service code を絞る (省略時は logsDir 配下の全 dir) */
  services?: string[];
  /** dryRun=true で削除せず候補だけ返す */
  dryRun?: boolean;
  /** 現在時刻 override (test 用) */
  now?: Date;
}

export interface SweepResult {
  scanned: number;
  removed: string[];
  kept: number;
}

export function sweep(opts: SweepOptions): SweepResult {
  const logsDir = resolveLogsDir(opts.logsDir);
  const now = opts.now ?? new Date();
  const result: SweepResult = { scanned: 0, removed: [], kept: 0 };

  if (opts.retentionDays === 0) return result;
  if (!fs.existsSync(logsDir)) return result;

  const today = ymdUtc(now);
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - opts.retentionDays,
  ));

  const serviceDirs = opts.services
    ? opts.services.map((s) => path.join(logsDir, s))
    : fs.readdirSync(logsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(logsDir, e.name));

  for (const dir of serviceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const date = parseYmd(entry.name);
      if (!date) continue;
      result.scanned++;
      if (entry.name.startsWith(today)) {
        result.kept++;
        continue;
      }
      if (date.getTime() < cutoff.getTime()) {
        const full = path.join(dir, entry.name);
        if (!opts.dryRun) {
          try { fs.unlinkSync(full); } catch { /* noop */ }
        }
        result.removed.push(full);
      } else {
        result.kept++;
      }
    }
  }

  return result;
}

export interface SweeperHandle {
  stop(): void;
}

/**
 * 周期 sweeper を起動。 startup で即 1 回 + intervalMs ごと。
 * intervalMs <= 0 で起動しない (即 stop 可能な dummy を返す)。
 */
export function startSweeper(opts: Required<Pick<SweepOptions, 'retentionDays'>> & {
  logsDir?: string;
  intervalMs: number;
  services?: string[];
}): SweeperHandle {
  if (opts.intervalMs <= 0 || opts.retentionDays <= 0) {
    return { stop() { /* noop */ } };
  }
  const run = () => {
    try { sweep(opts); } catch (err) {
      try { process.stderr.write(`[vestigium] sweep failed: ${(err as Error).message}\n`); }
      catch { /* swallow */ }
    }
  };
  run();
  const timer = setInterval(run, opts.intervalMs);
  // node の event loop を引き留めない
  if (typeof timer.unref === 'function') timer.unref();
  return { stop() { clearInterval(timer); } };
}
