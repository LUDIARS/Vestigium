import { VICTORIA_STREAM_FIELDS } from './record.js';

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
