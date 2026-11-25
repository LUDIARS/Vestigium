import { open } from 'node:fs/promises';
import { readBatch } from './batch.js';
import { fileKey, type CursorStore } from './checkpoints.js';
import { discoverSources, type LogSource } from './sources.js';

interface ExportOptions {
  root: string;
  cursors: CursorStore;
  send: (body: string) => Promise<void>;
  warn: (message: string) => void;
  signal?: AbortSignal;
}

class DestinationError extends Error {}

export async function exportLogs(options: ExportOptions): Promise<{ rows: number; failedFiles: number }> {
  const result = { rows: 0, failedFiles: 0 };
  for (const source of await discoverSources(options.root)) {
    if (options.signal?.aborted) break;
    try {
      await exportSource(source, options, (rows) => { result.rows += rows; });
    } catch (error) {
      result.failedFiles++;
      options.warn(`${source.path}: ${(error as Error).message}`);
      // A failed destination is shared by every source. Retry on the next pass.
      if (error instanceof DestinationError) break;
    }
  }
  return result;
}

async function exportSource(
  source: LogSource, options: ExportOptions, onCheckpoint: (rows: number) => void,
): Promise<void> {
  let file;
  try {
    file = await open(source.path, 'r');
  } catch (error) {
    // The writer may have rotated it after discovery. Next pass finds the archive.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile()) return;
    const end = Number(stat.size);
    if (!Number.isSafeInteger(end)) throw new Error('log file is too large to address by byte');
    const key = fileKey(stat, source.path);
    let offset = await options.cursors.load(key);
    if (offset > end) {
      options.warn(`${source.path}: file truncated; restarting at byte 0`);
      offset = 0;
      await options.cursors.save(key, offset);
    }
    while (offset < end && !options.signal?.aborted) {
      const batch = await readBatch(file, source, offset, end);
      if (batch.nextOffset === offset) break;
      if (batch.body) {
        try {
          await options.send(batch.body);
        } catch (error) {
          throw new DestinationError((error as Error).message, { cause: error });
        }
      }
      await options.cursors.save(key, batch.nextOffset);
      if (batch.invalidRows) {
        options.warn(`${source.path}: skipped ${batch.invalidRows} invalid row(s) at bytes ${offset}–${batch.nextOffset}`);
      }
      onCheckpoint(batch.rows);
      offset = batch.nextOffset;
    }
  } finally {
    await file.close();
  }
}
