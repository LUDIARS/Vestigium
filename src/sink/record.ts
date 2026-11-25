import { parse } from '../util/jsonl.js';
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

export function formatRecord(line: string, source: LogSource): string | undefined {
  const fields = { service: source.service, kind: source.kind };
  if (source.kind === 'service') {
    const record = parse(line);
    const time = instant(record?.ts);
    if (!record || !time || record.service !== source.service) return undefined;
    return JSON.stringify({
      ...fields, _time: time, _msg: record.msg, level: record.level,
      channel: record.channel, pid: record.pid, ctx: record.ctx,
    });
  }

  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record) || typeof record.msg !== 'string') return undefined;
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
