import { setTimeout as delay } from 'node:timers/promises';
import { openCursorStore } from '../sink/checkpoints.js';
import { exportLogs } from '../sink/export.js';
import { createInsertUrl, createVictoriaSender } from '../sink/victoria-http.js';
import { resolveLogsDir } from '../util/paths.js';

export async function runSink(
  origin: string, logsDir: string | undefined, watch: boolean,
): Promise<void> {
  const url = createInsertUrl(origin);
  const root = resolveLogsDir(logsDir);
  const cursors = await openCursorStore(root, url.origin);
  const send = createVictoriaSender(url);
  const stop = new AbortController();
  const onSignal = (): void => stop.abort();
  const warn = (message: string): void => { process.stderr.write(`[vestigium sink] ${message}\n`); };
  if (watch) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  }
  try {
    do {
      try {
        const { rows, failedFiles } = await exportLogs({ root, cursors, send, warn, signal: stop.signal });
        if (rows || !watch) process.stdout.write(`rows=${rows} failed_files=${failedFiles}\n`);
        if (!watch && failedFiles) process.exitCode = 1;
      } catch (error) {
        if (!watch) throw error;
        warn((error as Error).message);
      }
      if (watch && !stop.signal.aborted) {
        try {
          await delay(5_000, undefined, { signal: stop.signal });
        } catch (error) {
          if (!stop.signal.aborted) throw error;
        }
      }
    } while (watch && !stop.signal.aborted);
  } finally {
    if (watch) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }
}
