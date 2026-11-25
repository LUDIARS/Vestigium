import { parseLogRecord } from '../util/jsonl.js';
import type { LogSource } from './sources.js';

export const VICTORIA_STREAM_FIELDS = 'service,kind';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(value: unknown): string | undefined {
  const ms = typeof value === 'number' ? value
    : typeof value === 'string' && ISO_INSTANT.test(value) ? Date.parse(value) : NaN;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contractLevel(msg: string): string {
  if (msg === 'contract violated') return 'warn';
  if (msg === 'contract predicate threw') return 'error';
  return 'info';
}

export function resolveServiceAliases(row: Record<string, unknown>): { time: string; msg: string } | undefined {
  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : undefined;
  const alternateTime = typeof row.time === 'string' ? row.time : undefined;
  const time = (typeof row.ts === 'number' ? instant(row.ts) : undefined)
    ?? instant(timestamp) ?? instant(alternateTime);
  const msg = typeof row.msg === 'string' ? row.msg
    : typeof row.event === 'string' ? row.event : row.message;
  return time && typeof msg === 'string' ? { time, msg } : undefined;
}

function formatServiceRecord(row: Record<string, unknown>, source: LogSource) {
  if (row.service !== source.service) return undefined;
  let record = parseLogRecord(row);
  let time = instant(record?.ts);
  if (!time) {
    const aliases = resolveServiceAliases(row);
    if (!aliases) return undefined;
    time = aliases.time;
    record = parseLogRecord(row, Date.parse(time), aliases.msg);
  }
  if (!record) return undefined;
  return {
    service: source.service, kind: source.kind, _time: time, _msg: record.msg, level: record.level,
    channel: record.channel, pid: record.pid, ctx: record.ctx,
  };
}

export function formatRecord(line: string, source: LogSource): string | undefined {
  const fields = { service: source.service, kind: source.kind };
  let record: unknown;
  try {
    record = JSON.parse(source.kind === 'service' ? line.trim() : line);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  if (source.kind === 'service') return JSON.stringify(formatServiceRecord(record, source));
  if (typeof record.msg !== 'string') return undefined;
  const ctx = isRecord(record.ctx) ? record.ctx : {};
  const time = instant(ctx.observed_at) ?? instant(record.time) ?? instant(record.ts);
  if (!time) return undefined;
  return JSON.stringify({
    ...fields, _time: time, _msg: record.msg,
    level: typeof record.level === 'string' ? record.level : contractLevel(record.msg),
    contract_id: typeof ctx.contract === 'string' ? ctx.contract : undefined,
    ctx,
  });
}
