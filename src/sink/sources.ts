import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { parseYmd, sanitizeCode } from '../util/paths.js';

export interface LogSource {
  path: string;
  service: string;
  kind: 'service' | 'contract';
}

async function children(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [];
  }
}

function isServiceCode(name: string): boolean {
  try {
    return sanitizeCode(name) === name;
  } catch {
    return false;
  }
}

export async function discoverSources(root: string): Promise<LogSource[]> {
  const sources: LogSource[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isFile() && entry.name === 'contracts.jsonl') {
      sources.push({ path: file, service: 'augur', kind: 'contract' });
    } else if (entry.isFile() && /^contracts-actio-\d{4}-\d{2}-\d{2}-[\w-]+\.jsonl$/.test(entry.name)) {
      sources.push({ path: file, service: 'actio', kind: 'contract' });
    } else if (entry.isDirectory() && isServiceCode(entry.name)) {
      for (const child of await children(file)) {
        if (!child.isFile() || !child.name.endsWith('.jsonl')) continue;
        const childPath = path.join(file, child.name);
        if (entry.name === 'archive' && /^contracts-\d{4}-\d{2}-\d{2}\.jsonl$/.test(child.name)) {
          sources.push({ path: childPath, service: 'augur', kind: 'contract' });
        } else if (parseYmd(child.name)) {
          sources.push({ path: childPath, service: entry.name, kind: 'service' });
        }
      }
    }
  }
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}
