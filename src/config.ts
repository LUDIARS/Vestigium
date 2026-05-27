import { z } from 'zod';
import { resolveLogsDir, sanitizeCode } from './util/paths.js';

export const ConfigSchema = z.object({
  serviceCode: z.string().min(1).transform(sanitizeCode),
  logsDir: z.string().optional(),
  retentionDays: z.number().int().min(0).max(3650).default(14),
  captureConsole: z.boolean().default(false),
  pinoTransport: z.boolean().default(false),
  /** sweep interval (ms). 0 で無効。 default 1h */
  sweepIntervalMs: z.number().int().min(0).default(60 * 60 * 1000),
  /** flush interval (ms). 0 = 1 行ごとに sync */
  flushIntervalMs: z.number().int().min(0).default(0),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig extends Config {
  resolvedLogsDir: string;
}

export function resolveConfig(input: unknown): ResolvedConfig {
  const parsed = ConfigSchema.parse(input);
  return { ...parsed, resolvedLogsDir: resolveLogsDir(parsed.logsDir) };
}
