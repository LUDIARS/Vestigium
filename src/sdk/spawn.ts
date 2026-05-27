/**
 * child_process の stdout/stderr を line-by-line に Vestigium へ流す。
 * Concordia 側で「サービスを spawn したが、 そのサービスが Vestigium SDK 未対応」
 * のケースで使う移行期 helper。
 */

import type { ChildProcess } from 'node:child_process';
import type { Writer } from '../writer.js';
import type { Channel } from '../util/jsonl.js';

export interface RedirectOptions {
  writer: Writer;
  channelStdout?: Channel;
  channelStderr?: Channel;
}

export function redirectChild(child: ChildProcess, opts: RedirectOptions): void {
  attach(child, 'stdout', opts.channelStdout ?? 'stdout', opts.writer);
  attach(child, 'stderr', opts.channelStderr ?? 'stderr', opts.writer);
}

function attach(
  child: ChildProcess,
  stream: 'stdout' | 'stderr',
  channel: Channel,
  writer: Writer,
): void {
  const s = child[stream];
  if (!s) return;
  let buf = '';
  s.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        writer.write({
          level: channel === 'stderr' ? 'error' : 'info',
          msg: line,
          channel,
        });
      }
    }
  });
  s.on('end', () => {
    if (buf.length > 0) {
      writer.write({
        level: channel === 'stderr' ? 'error' : 'info',
        msg: buf,
        channel,
      });
      buf = '';
    }
  });
}
