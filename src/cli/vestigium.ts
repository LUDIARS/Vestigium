#!/usr/bin/env node
/**
 * vestigium CLI — tail / list / sweep / recent / search。
 *
 *   vestigium tail <service> [-n 200] [--from-tail 50]
 *   vestigium list
 *   vestigium sweep [--retention 14] [--dry-run]
 *   vestigium recent <service> [-n 200] [--level error,warn]
 *   vestigium search <service> [<service>...] --pattern <regex>
 */

import { tailService } from '../reader/tail.js';
import { recent, search, listServices, lastSeenAt } from '../reader/recent.js';
import { sweep } from '../rotator.js';
import { resolveLogsDir } from '../util/paths.js';
import type { LogLevel, LogRecord } from '../util/jsonl.js';

interface ParsedArgs {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function printLine(rec: LogRecord): void {
  const iso = new Date(rec.ts).toISOString();
  const lvl = rec.level.toUpperCase().padEnd(5);
  const ch = rec.channel === 'app' ? '' : `[${rec.channel}] `;
  const ctx = rec.ctx ? ' ' + JSON.stringify(rec.ctx) : '';
  process.stdout.write(`${iso} ${lvl} ${rec.service} ${ch}${rec.msg}${ctx}\n`);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0];
  const logsDir = typeof args.flags['logs-dir'] === 'string'
    ? args.flags['logs-dir'] as string
    : undefined;

  switch (cmd) {
    case 'tail': {
      const svc = args._[1];
      if (!svc) { fail('usage: vestigium tail <service> [-n 200]'); return; }
      const n = Number(args.flags.n ?? args.flags['from-tail'] ?? 50);
      const handle = tailService({
        serviceCode: svc,
        logsDir,
        fromTail: isFinite(n) ? n : 50,
        onLine: printLine,
        onError: (err) => process.stderr.write(`[vestigium] ${err.message}\n`),
      });
      // SIGINT で停止
      process.on('SIGINT', () => { handle.stop(); process.exit(0); });
      // event loop を keep
      setInterval(() => { /* keep alive */ }, 1 << 30);
      break;
    }
    case 'list': {
      const services = listServices(logsDir);
      const dir = resolveLogsDir(logsDir);
      process.stdout.write(`logs dir: ${dir}\n`);
      if (services.length === 0) {
        process.stdout.write('(no services)\n');
        return;
      }
      for (const s of services) {
        const last = lastSeenAt(s, logsDir);
        const lastStr = last ? new Date(last).toISOString() : '(no entries)';
        process.stdout.write(`  ${s.padEnd(28)} last=${lastStr}\n`);
      }
      break;
    }
    case 'sweep': {
      const retention = Number(args.flags.retention ?? 14);
      const dry = args.flags['dry-run'] === true;
      const r = sweep({
        logsDir,
        retentionDays: isFinite(retention) ? retention : 14,
        dryRun: dry,
      });
      process.stdout.write(
        `scanned=${r.scanned} removed=${r.removed.length} kept=${r.kept}${dry ? ' (dry-run)' : ''}\n`,
      );
      for (const f of r.removed) process.stdout.write(`  - ${f}\n`);
      break;
    }
    case 'recent': {
      const svc = args._[1];
      if (!svc) { fail('usage: vestigium recent <service> [-n 200] [--level error,warn]'); return; }
      const n = Number(args.flags.n ?? 200);
      const levelArg = args.flags.level;
      const level = typeof levelArg === 'string'
        ? (levelArg.split(',') as LogLevel[])
        : undefined;
      const recs = recent({ serviceCode: svc, logsDir, limit: n, level });
      for (const r of recs.reverse()) printLine(r);
      break;
    }
    case 'search': {
      const pattern = args.flags.pattern;
      if (typeof pattern !== 'string') { fail('usage: vestigium search <service>... --pattern <regex>'); return; }
      const svcs = args._.slice(1);
      if (svcs.length === 0) { fail('at least one service required'); return; }
      const n = Number(args.flags.n ?? 200);
      const hits = search({ serviceCodes: svcs, logsDir, pattern, limit: n });
      for (const r of hits.reverse()) printLine(r);
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      fail(`unknown command: ${cmd}`);
  }
}

function help(): void {
  process.stdout.write(`vestigium — JSONL log inspector

Commands:
  tail <service> [-n 50]          follow service log (current day, then auto-roll)
  list                            list known services + last seen ts
  sweep [--retention 14] [--dry-run]
                                  delete files older than retentionDays
  recent <service> [-n 200] [--level error,warn]
                                  print recent N lines (latest last)
  search <service>... --pattern <regex> [-n 200]
                                  cross-service search

Global flag: --logs-dir <path>   override VESTIGIUM_LOGS_DIR / cwd/logs
`);
}

function fail(msg: string): void {
  process.stderr.write(msg + '\n');
  process.exitCode = 2;
}

void main().catch((err: unknown) => {
  process.stderr.write(`[vestigium] ${(err as Error).message}\n`);
  process.exitCode = 1;
});
