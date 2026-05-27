// E2E smoke: write via SDK → read via reader → verify CLI output.
import { install, sweep, createWriter } from '../dist/index.js';
import { recent, search, listServices, lastSeenAt } from '../dist/reader/index.js';
import { rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const logsDir = path.join(tmpdir(), 'vestigium-smoke-' + Date.now());

function step(name) { console.log(`\n## ${name}`); }

step('1) install() + pino + console hook');
const v = install({
  serviceCode: 'cernere',
  logsDir,
  captureConsole: true,
  retentionDays: 1,
});
v.writer.write({ level: 'info', msg: 'boot complete', ctx: { trace_id: 'abc' } });
v.writer.write({ level: 'error', msg: 'oh no' });
console.warn('routed-via-console-hook');
await v.shutdown();

step('2) listServices');
console.log(listServices(logsDir));

step('3) recent (latest first)');
console.log(recent({ serviceCode: 'cernere', logsDir, limit: 10 }).map((r) => `${r.level} ${r.msg}`));

step('4) search regex across services');
const w2 = createWriter({ serviceCode: 'actio', logsDir });
w2.write({ level: 'info', msg: 'connection refused' });
await w2.close();
console.log(
  search({ serviceCodes: ['cernere', 'actio'], logsDir, pattern: 'refus|oh no' })
    .map((r) => `${r.service} ${r.msg}`),
);

step('5) lastSeenAt');
console.log('cernere lastSeenAt =', lastSeenAt('cernere', logsDir));

step('6) sweep dry-run');
console.log(sweep({ logsDir, retentionDays: 0, dryRun: true }));

step('7) cleanup');
if (existsSync(logsDir)) rmSync(logsDir, { recursive: true, force: true });
console.log('done.');
