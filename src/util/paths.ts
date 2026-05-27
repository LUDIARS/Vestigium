import path from 'node:path';
import os from 'node:os';

const SAFE_CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function resolveLogsDir(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return path.resolve(explicit);
  const env = process.env.VESTIGIUM_LOGS_DIR;
  if (env && env.trim().length > 0) return path.resolve(env);
  return path.resolve(process.cwd(), 'logs');
}

export function serviceDir(logsDir: string, serviceCode: string): string {
  return path.join(logsDir, sanitizeCode(serviceCode));
}

/**
 * 当日 file path (UTC 基準)。 dateOverride を渡せばその日付の path を返す。
 */
export function dayFile(logsDir: string, serviceCode: string, when: Date = new Date()): string {
  const ymd = ymdUtc(when);
  return path.join(serviceDir(logsDir, serviceCode), `${ymd}.jsonl`);
}

export function ymdUtc(when: Date): string {
  const y = when.getUTCFullYear().toString().padStart(4, '0');
  const m = (when.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = when.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.jsonl(\.gz)?$/.exec(name);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!y || !mm || !dd) return null;
  return new Date(Date.UTC(y, mm - 1, dd));
}

export function sanitizeCode(code: string): string {
  const lower = code.toLowerCase();
  if (!SAFE_CODE.test(lower)) {
    throw new Error(
      `invalid service code "${code}" — must match ${SAFE_CODE.source} (lowercase alnum + _ - 64 chars)`,
    );
  }
  return lower;
}

export function tempLogsDir(prefix = 'vestigium-test-'): string {
  return path.join(os.tmpdir(), prefix + Math.random().toString(36).slice(2, 10));
}
