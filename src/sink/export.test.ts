import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCursorStore } from './checkpoints.js';
import { exportLogs } from './export.js';
import { createInsertUrl, createVictoriaSender } from './victoria-http.js';

const origin = 'http://127.0.0.1:9428';
const ts = Date.parse('2026-11-25T02:03:04Z');

function serviceRow(msg: string): string {
  return JSON.stringify({ ts, service: 'actio', level: 'warn', channel: 'app', msg }) + '\r\n';
}

function contractRow(contract: string): string {
  return JSON.stringify({
    time: new Date(ts).toISOString(), msg: 'contract violated', ctx: { contract },
  }) + '\n';
}

describe('VictoriaLogs export', () => {
  let root: string;
  const send = vi.fn<(body: string) => Promise<void>>();
  const warn = vi.fn();

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'vestigium-sink-'));
    send.mockReset().mockResolvedValue(undefined);
    warn.mockReset();
    await mkdir(path.join(root, 'actio'));
    await mkdir(path.join(root, 'archive'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function run() {
    return exportLogs({ root, cursors: await openCursorStore(root, origin), send, warn });
  }

  it('retries a failed batch and resumes at the persisted byte offset after success', async () => {
    const file = path.join(root, 'actio', '2026-11-25.jsonl');
    const existing = serviceRow('最初');
    await writeFile(file, existing);
    send.mockRejectedValueOnce(new Error('HTTP 503'));

    expect(await run()).toEqual({ rows: 0, failedFiles: 1 });
    expect(await readFile(file, 'utf8')).toBe(existing);
    expect(await run()).toEqual({ rows: 1, failedFiles: 0 });
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(await run()).toEqual({ rows: 0, failedFiles: 0 });
    expect(send).toHaveBeenCalledTimes(2);

    const partial = Buffer.from(serviceRow('次'));
    const cut = partial.indexOf(Buffer.from('次')) + 1;
    await appendFile(file, partial.subarray(0, cut));
    expect(await run()).toEqual({ rows: 0, failedFiles: 0 });
    await appendFile(file, partial.subarray(cut));
    expect(await run()).toEqual({ rows: 1, failedFiles: 0 });
    expect(JSON.parse(send.mock.calls[2]![0])).toMatchObject({
      _msg: '次', _time: '2026-11-25T02:03:04.000Z', service: 'actio', kind: 'service', level: 'warn',
    });
  });

  it('continues a renamed Augur file and reads the replacement and Actio contract file', async () => {
    const active = path.join(root, 'contracts.jsonl');
    await writeFile(active, contractRow('old'));
    expect((await run()).rows).toBe(1);
    await appendFile(active, contractRow('late'));
    await rename(active, path.join(root, 'archive', 'contracts-2026-11-25.jsonl'));
    await writeFile(active, contractRow('new'));
    await writeFile(path.join(root, 'contracts-actio-2026-11-25-session.jsonl'), contractRow('actio-contract'));
    await writeFile(path.join(root, 'archive', '.contracts-2026-11-25.123.part'), contractRow('temporary'));
    send.mockClear();

    expect(await run()).toEqual({ rows: 3, failedFiles: 0 });
    const rows = send.mock.calls.flatMap(([body]) => body.trimEnd().split('\n').map((line) => JSON.parse(line)));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ contract_id: 'late', service: 'augur', kind: 'contract', level: 'warn' }),
      expect.objectContaining({ contract_id: 'new', service: 'augur' }),
      expect.objectContaining({ contract_id: 'actio-contract', service: 'actio' }),
    ]));
  });

  it('continues past a malformed row without logging its contents', async () => {
    await writeFile(path.join(root, 'actio', '2026-11-25.jsonl'), 'private invalid row\n' + serviceRow('valid'));
    expect(await run()).toEqual({ rows: 1, failedFiles: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped 1 invalid row'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('private invalid row'));
    expect(await run()).toEqual({ rows: 0, failedFiles: 0 });
  });

  it('exports Revisor rows and resolves timestamp and message aliases in order', async () => {
    const dir = path.join(root, 'revisor');
    const timestamp = '2026-11-25T00:00:14.283Z';
    const time = '2026-11-25T09:00:15+09:00';
    await mkdir(dir);
    const rows = [
      { timestamp, level: 'info', event: 'heartbeat' },
      { ts, timestamp, time, msg: 'native', event: 'unused', message: 'unused' },
      { ts: 'invalid', timestamp, time, msg: null, event: 'preferred', message: 'unused' },
      { timestamp: 'invalid', time, event: false, message: 'fallback', level: 'warn' },
      { time: 123, event: 'no valid time' },
      { timestamp, message: 123 },
      { timestamp, event: 'wrong service', service: 'actio' },
    ];
    await writeFile(path.join(dir, '2026-11-25.jsonl'), rows
      .map((row) => JSON.stringify({ service: 'revisor', ...row })).join('\n') + '\n');

    expect(await run()).toEqual({ rows: 4, failedFiles: 0 });
    const sent = send.mock.calls.flatMap(([body]) => body.trimEnd().split('\n')
      .map((line) => JSON.parse(line)));
    expect(sent).toMatchObject([
      { _time: timestamp, _msg: 'heartbeat', service: 'revisor', kind: 'service', level: 'info', channel: 'app' },
      { _time: new Date(ts).toISOString(), _msg: 'native' },
      { _time: timestamp, _msg: 'preferred' },
      { _time: '2026-11-25T00:00:15.000Z', _msg: 'fallback', level: 'warn' },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped 3 invalid row(s)'));
    expect(await run()).toEqual({ rows: 0, failedFiles: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses the expected HTTP fields and rejects non-success responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const url = createInsertUrl(origin);
      await expect(createVictoriaSender(url)('{}\n')).rejects.toThrow('HTTP 503');
      expect(url.pathname).toBe('/insert/jsonline');
      expect(url.searchParams.get('_stream_fields')).toBe('service,kind');
      expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
        method: 'POST', body: '{}\n', redirect: 'error',
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
