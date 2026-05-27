/**
 * pino 用の writable destination。 pino logger は file/stream に書ける ので、
 * ここでは「pino の JSON 行を読んで Vestigium writer に変換する」 Writable を返す。
 *
 * peer dep の pino が未 install でも import 可能にするため、 動的 import は使わず
 * Writable は直接 implement する。
 */

import { Writable } from 'node:stream';
import type { Writer } from '../writer.js';
import type { LogLevel } from '../util/jsonl.js';

// pino 数値レベル → vestigium level
function pinoLevelToVestigium(level: number | string | undefined): LogLevel {
  const n = typeof level === 'string' ? Number(level) : level;
  if (!n || Number.isNaN(n)) return 'info';
  if (n >= 60) return 'fatal';
  if (n >= 50) return 'error';
  if (n >= 40) return 'warn';
  if (n >= 30) return 'info';
  if (n >= 20) return 'debug';
  return 'trace';
}

/**
 * pino({}, dest) の dest にそのまま渡せる Writable。
 *
 *   const logger = pino({}, createPinoDestination({writer}));
 */
export function createPinoDestination(opts: { writer: Writer }): Writable {
  let buf = '';
  return new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) handleLine(line, opts.writer);
      }
      cb();
    },
    final(cb) {
      if (buf) handleLine(buf, opts.writer);
      buf = '';
      cb();
    },
  });
}

function handleLine(line: string, writer: Writer): void {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const level = pinoLevelToVestigium(obj.level as number | string | undefined);
    const msg = typeof obj.msg === 'string' ? obj.msg : line;
    const ts = typeof obj.time === 'number' ? obj.time : Date.now();
    // pino base fields を除いた残りを ctx に
    const ctx: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'level' || k === 'time' || k === 'msg' || k === 'pid' || k === 'hostname' || k === 'v') continue;
      ctx[k] = v;
    }
    writer.write({
      level,
      msg,
      ts,
      channel: 'app',
      ctx: Object.keys(ctx).length > 0 ? ctx : undefined,
      pid: typeof obj.pid === 'number' ? obj.pid : undefined,
    });
  } catch {
    // pino 形式でなければ生 line を info で記録
    writer.write({ level: 'info', msg: line, channel: 'app' });
  }
}
