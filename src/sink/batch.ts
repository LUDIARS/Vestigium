import type { FileHandle } from 'node:fs/promises';
import { formatRecord } from './record.js';
import type { LogSource } from './sources.js';

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

interface Batch {
  nextOffset: number;
  body: string;
  invalidRows: number;
  rows: number;
}

export async function readBatch(
  file: FileHandle, source: LogSource, offset: number, end: number,
): Promise<Batch> {
  const buffer = Buffer.allocUnsafe(Math.min(MAX_SOURCE_BYTES, end - offset));
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await file.read(buffer, length, buffer.length - length, offset + length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  const data = buffer.subarray(0, length);
  const lines: string[] = [];
  let bodyBytes = 0;
  let invalidRows = 0;
  let start = 0;
  for (let lf = data.indexOf(10); lf !== -1; lf = data.indexOf(10, start)) {
    let line: string;
    try {
      line = utf8.decode(data.subarray(start, lf));
    } catch {
      invalidRows++;
      start = lf + 1;
      continue;
    }
    const row = formatRecord(line, source);
    if (row !== undefined) {
      const bytes = Buffer.byteLength(row) + 1;
      if (bodyBytes + bytes > MAX_BODY_BYTES && start > 0) break;
      if (bytes > MAX_BODY_BYTES) {
        throw new Error(`formatted log row exceeds ${MAX_BODY_BYTES} bytes at offset ${offset + start}`);
      }
      lines.push(row);
      bodyBytes += bytes;
    } else if (line.trim()) {
      invalidRows++;
    }
    start = lf + 1;
  }
  if (start === 0 && length === MAX_SOURCE_BYTES) {
    throw new Error(`no complete log row within ${MAX_SOURCE_BYTES} bytes at offset ${offset}`);
  }
  return {
    nextOffset: offset + start, body: lines.length ? lines.join('\n') + '\n' : '',
    invalidRows, rows: lines.length,
  };
}
