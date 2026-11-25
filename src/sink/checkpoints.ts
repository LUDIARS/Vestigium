import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export interface CursorStore {
  load(key: string): Promise<number>;
  save(key: string, offset: number): Promise<void>;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function fileKey(stat: BigIntStats, sourcePath: string): string {
  // A rename/hard link preserves the identity on NTFS and Unix.
  const identity = stat.ino === 0n ? sourcePath : `${stat.dev}:${stat.ino}`;
  return digest(`${identity}:${stat.birthtimeNs}`);
}

export async function openCursorStore(root: string, destination: string): Promise<CursorStore> {
  if (!(await stat(root)).isDirectory()) throw new Error('VictoriaLogs log root is not a directory');
  const directory = path.join(root, '.vestigium-victorialogs', digest(destination));
  await mkdir(directory, { recursive: true });
  return {
    async load(key) {
      let data: string;
      try {
        data = await readFile(path.join(directory, key), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
      const offset = Number(data);
      if (!/^\d+\n$/.test(data) || !Number.isSafeInteger(offset)) {
        throw new Error(`invalid VictoriaLogs checkpoint ${key}`);
      }
      return offset;
    },
    async save(key, offset) {
      const target = path.join(directory, key);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx');
        try {
          await handle.writeFile(`${offset}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
