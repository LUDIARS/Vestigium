/**
 * global console を hook して writer に流す。
 * 元の console method は保持して通常出力も保つ (二重出力)。 unhook で復元。
 */
import { inspect } from 'node:util';
import type { Writer } from '../writer.js';
import type { LogLevel } from '../util/jsonl.js';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';

const LEVEL_MAP: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
  trace: 'trace',
};

export interface ConsoleHook {
  unhook(): void;
}

export interface HookOptions {
  writer: Writer;
  /** stderr 系 method は channel='stderr'、 他は 'app' に倒す */
  classifyChannel?: boolean;
}

export function hookConsole(opts: HookOptions): ConsoleHook {
  const classify = opts.classifyChannel ?? true;
  const originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  for (const m of methods) {
    const orig = (console as unknown as Record<string, (...args: unknown[]) => void>)[m];
    if (typeof orig !== 'function') continue;
    originals[m] = orig.bind(console);
    (console as unknown as Record<string, (...args: unknown[]) => void>)[m] = (
      ...args: unknown[]
    ) => {
      try {
        opts.writer.write({
          level: LEVEL_MAP[m],
          msg: formatArgs(args),
          channel: classify && (m === 'error' || m === 'warn') ? 'stderr' : 'app',
        });
      } catch { /* never throw from console */ }
      try { originals[m]!(...args); } catch { /* noop */ }
    };
  }

  return {
    unhook() {
      for (const m of methods) {
        const orig = originals[m];
        if (orig) {
          (console as unknown as Record<string, (...args: unknown[]) => void>)[m] = orig;
        }
      }
    },
  };
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  if (args.length === 1) {
    const a = args[0];
    return typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: 200 });
  }
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: 200 })))
    .join(' ');
}
