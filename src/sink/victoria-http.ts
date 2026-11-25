import { VICTORIA_STREAM_FIELDS } from './record.js';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:aa05a1c4 */
import augurContract_9820de45 from './contracts/insert-url.contract.js'; /* augur-inject:contract-predicate:a0bebd1e */

export function createInsertUrl(origin: string): URL {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VictoriaLogs URL must be an HTTP(S) origin without credentials');
  }
  url.pathname = '/insert/jsonline';
  url.searchParams.set('_time_field', '_time');
  url.searchParams.set('_msg_field', '_msg');
  url.searchParams.set('_stream_fields', VICTORIA_STREAM_FIELDS);
  return url;
}
// @ts-expect-error augur-inject
createInsertUrl = contract(createInsertUrl, { ...augurContract_9820de45, contractId: 'C-1', mode: 'observe', sample: 1, where: 'src/sink/victoria-http.ts:3', rule: 'contract-wrap', id: '9820de45' }); /* augur-inject:contract-wrap:9820de45 */

export function createVictoriaSender(url: URL): (body: string) => Promise<void> {
  return async (body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/stream+json' },
      redirect: 'error',
      body,
      signal: AbortSignal.timeout(15_000),
    });
    // Drain to EOF before acknowledging. Receiving headers alone is insufficient.
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (!(await reader.read()).done) { /* VictoriaLogs response has no payload we need. */ }
      } finally {
        reader.releaseLock();
      }
    }
    if (!response.ok) throw new Error(`VictoriaLogs returned HTTP ${response.status}`);
  };
}
