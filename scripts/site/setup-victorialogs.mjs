import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, link, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const VERSION = 'v1.54.0';
const ARCHIVE = `victoria-logs-windows-amd64-${VERSION}.zip`;
const ARCHIVE_BYTES = 6_466_498;
const ARCHIVE_SHA256 = '7b864069df2bf6d600e8165db56f889347102c8b0a2d01c352babb38d27beaa5';
const EXE = 'victoria-logs-windows-amd64-prod.exe';
const EXE_SHA256 = '41efd22e62ffe0498b7249fec024e9526c33d467f4ed1c506c45fbe93622f64e';
const ALLOWED_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);
const directory = fileURLToPath(new URL('../../.local/victorialogs/', import.meta.url));
const run = promisify(execFile);

function checkHash(bytes, expected, name) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`${name} checksum mismatch`);
  }
}

async function download() {
  let url = new URL(`https://github.com/VictoriaMetrics/VictoriaLogs/releases/download/${VERSION}/${ARCHIVE}`);
  const signal = AbortSignal.timeout(120_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !ALLOWED_HOSTS.has(url.hostname)) {
      throw new Error('unexpected VictoriaLogs download host');
    }
    const response = await fetch(url, { redirect: 'manual', signal });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`VictoriaLogs download returned HTTP ${response.status}`);
    }
    const archive = Buffer.alloc(ARCHIVE_BYTES);
    let offset = 0;
    for await (const chunk of response.body) {
      if (offset + chunk.byteLength > archive.length) throw new Error('VictoriaLogs archive is too large');
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (offset !== archive.length) throw new Error('unexpected VictoriaLogs archive size');
    return archive;
  }
  throw new Error('too many redirects for the VictoriaLogs download');
}

async function setup() {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.env.SystemRoot) {
    throw new Error('VictoriaLogs setup requires Windows x64, native Node.js and SystemRoot');
  }
  await mkdir(directory, { recursive: true });
  const installed = path.join(directory, EXE);
  try {
    checkHash(await readFile(installed), EXE_SHA256, EXE);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = await mkdtemp(path.join(directory, 'setup-'));
  try {
    const bytes = await download();
    checkHash(bytes, ARCHIVE_SHA256, ARCHIVE);
    const archive = path.join(temp, ARCHIVE);
    await writeFile(archive, bytes, { flag: 'wx' });
    await run(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', archive, EXE], {
      cwd: temp, windowsHide: true, timeout: 60_000,
    });
    const extracted = path.join(temp, EXE);
    checkHash(await readFile(extracted), EXE_SHA256, EXE);
    try {
      await link(extracted, installed);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      checkHash(await readFile(installed), EXE_SHA256, EXE);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

try {
  await setup();
  process.stdout.write(`VictoriaLogs ${VERSION} is ready for Excubitor.\n`);
} catch (error) {
  process.stderr.write(`[setup-victorialogs] ${error.message}\n`);
  process.exitCode = 1;
}
