/**
 * @ludiars/vestigium — entry。
 *
 * 公開 API:
 *   - install(config)        : 一発で writer + console hook + sweeper を立ち上げ
 *   - createWriter(opts)     : 低レベル writer 単体
 *   - sweep(opts)            : retention sweep を 1 回実行
 *   - startSweeper(opts)     : 周期 sweeper
 *   - reader subpath         : tail / recent / search / listServices
 *   - sdk subpath            : hookConsole / createPinoDestination / redirectChild
 */

import { resolveConfig } from './config.js';
import { createWriter, type Writer } from './writer.js';
import { startSweeper, type SweeperHandle } from './rotator.js';
import { hookConsole, type ConsoleHook } from './sdk/console.js';
import { createPinoDestination } from './sdk/logger.js';
import type { Writable } from 'node:stream';

export interface Vestigium {
  writer: Writer;
  logsDir: string;
  serviceCode: string;
  /** pinoTransport=true 時、 pino({}, dest) の dest に渡す Writable */
  pinoDestination?: Writable;
  /** captureConsole=true 時、 unhook できるハンドル */
  consoleHook?: ConsoleHook;
  sweeper: SweeperHandle;
  shutdown(): Promise<void>;
}

export function install(input: unknown): Vestigium {
  const config = resolveConfig(input);
  const writer = createWriter({
    serviceCode: config.serviceCode,
    logsDir: config.resolvedLogsDir,
  });
  const sweeper = startSweeper({
    logsDir: config.resolvedLogsDir,
    retentionDays: config.retentionDays,
    intervalMs: config.sweepIntervalMs,
  });
  let consoleHook: ConsoleHook | undefined;
  if (config.captureConsole) {
    consoleHook = hookConsole({ writer });
  }
  let pinoDestination: Writable | undefined;
  if (config.pinoTransport) {
    pinoDestination = createPinoDestination({ writer });
  }
  return {
    writer,
    logsDir: writer.logsDir,
    serviceCode: writer.serviceCode,
    pinoDestination,
    consoleHook,
    sweeper,
    async shutdown() {
      sweeper.stop();
      consoleHook?.unhook();
      await writer.close();
    },
  };
}

export { createWriter } from './writer.js';
export { sweep, startSweeper } from './rotator.js';
export { resolveConfig, ConfigSchema } from './config.js';
export type { Writer, WriteInput, WriterOptions } from './writer.js';
export type { SweepOptions, SweepResult, SweeperHandle } from './rotator.js';
export type { Config, ResolvedConfig } from './config.js';
export type { LogLevel, Channel, LogRecord } from './util/jsonl.js';
export { LOG_LEVELS, CHANNELS, serialize as serializeRecord, parse as parseRecord } from './util/jsonl.js';
export { resolveLogsDir, serviceDir as resolveServiceDir, dayFile as resolveDayFile, ymdUtc, sanitizeCode } from './util/paths.js';
