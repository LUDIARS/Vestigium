/**
 * JSONL 1 行スキーマ + serialize/parse helpers。
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const CHANNELS = ['stdout', 'stderr', 'app', 'llm'] as const;
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
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === 'object' ? parseLogRecord(value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseLogRecord(
  record: Record<string, unknown>, ts: unknown = record.ts, msg: unknown = record.msg,
): LogRecord | null {
  const { service, level, channel, pid, ctx } = record;
  if (typeof ts !== 'number' || typeof service !== 'string' || typeof msg !== 'string') return null;
  return {
    ts,
    service,
    msg,
    level: (LOG_LEVELS as readonly string[]).includes(level as string) ? level as LogLevel : 'info',
    channel: (CHANNELS as readonly string[]).includes(channel as string) ? channel as Channel : 'app',
    pid: typeof pid === 'number' ? pid : undefined,
    ctx: ctx && typeof ctx === 'object' ? ctx as Record<string, unknown> : undefined,
  };
}

function truncate(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  const cut = buf.subarray(0, maxBytes - 32).toString('utf8');
  return `${cut}…(truncated ${buf.length - (maxBytes - 32)})`;
}
