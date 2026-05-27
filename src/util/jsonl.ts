/**
 * JSONL 1 行スキーマ + serialize/parse helpers。
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const CHANNELS = ['stdout', 'stderr', 'app'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface LogRecord {
  ts: number;
  level: LogLevel;
  service: string;
  channel: Channel;
  msg: string;
  pid?: number;
  ctx?: Record<string, unknown>;
}

const MAX_MSG_BYTES = 64 * 1024;

export function serialize(rec: LogRecord): string {
  const safe: LogRecord = { ...rec, msg: truncate(rec.msg, MAX_MSG_BYTES) };
  return JSON.stringify(safe) + '\n';
}

export function parse(line: string): LogRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.ts !== 'number' || typeof o.service !== 'string' || typeof o.msg !== 'string') {
      return null;
    }
    const level = (LOG_LEVELS as readonly string[]).includes(o.level as string)
      ? (o.level as LogLevel)
      : 'info';
    const channel = (CHANNELS as readonly string[]).includes(o.channel as string)
      ? (o.channel as Channel)
      : 'app';
    return {
      ts: o.ts,
      level,
      service: o.service,
      channel,
      msg: o.msg,
      pid: typeof o.pid === 'number' ? o.pid : undefined,
      ctx: o.ctx && typeof o.ctx === 'object' ? (o.ctx as Record<string, unknown>) : undefined,
    };
  } catch {
    return null;
  }
}

function truncate(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  const cut = buf.subarray(0, maxBytes - 32).toString('utf8');
  return `${cut}…(truncated ${buf.length - (maxBytes - 32)})`;
}
