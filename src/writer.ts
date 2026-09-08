/**
 * JSONL writer (per-service)。
 *
 * - 日付境界 (UTC) で出力先 file を切替
 * - write は append (createWriteStream(flags='a'))
 * - 失敗は process.stderr に warning を出すだけで投げない (サービス本体を落とさない)
 */

import fs from 'node:fs';
import { WriteErrorReporter } from './writer-error.js';
import { dayFile, serviceDir, ymdUtc, resolveLogsDir } from './util/paths.js';
import { serialize, type Channel, type LogLevel, type LogRecord } from './util/jsonl.js';

export interface WriterOptions {
  serviceCode: string;
  logsDir?: string;
}

export interface WriteInput {
  level?: LogLevel;
  msg: string;
  channel?: Channel;
  ts?: number;
  ctx?: Record<string, unknown>;
  pid?: number;
}

export interface Writer {
  readonly serviceCode: string;
  readonly logsDir: string;
  currentFile(): string;
  write(input: WriteInput): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function createWriter(opts: WriterOptions): Writer {
  const serviceCode = opts.serviceCode;
  const logsDir = resolveLogsDir(opts.logsDir);
  // serviceCode の検証はここで行う (不正な値は呼び出し側の誤りなので投げる)。
  const dir = serviceDir(logsDir, serviceCode);
  // ただし **mkdir の失敗では投げない**。 ログが取れないことと、 サービスが動かない
  // ことは別 (module header の方針)。 開けなければ write 側で試し直す。
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 出力先を用意できない — ログだけ諦める */
  }

  const startedAt = new Date();
  let currentYmd = ymdUtc(startedAt);
  let closed = false;
  const errors = new WriteErrorReporter();
  let stream: fs.WriteStream | null = null;

  function open(now: Date): fs.WriteStream {
    const opened = openStream(logsDir, serviceCode, now, (err) => {
      errors.report(err);
      // ローテーション後に旧streamのerrorが届いても新streamは失わない。
      if (stream === opened) stream = null;
      opened.destroy();
    });
    return opened;
  }

  // 生成時に開けなくてもサービスは動く。 ログだけ諦める。
  // currentYmd と同じ時刻を使う (別々に new Date() すると UTC 日跨ぎで
  // currentYmd と実際の出力先がずれ、 次の rotation まで前日 file へ追記し続ける)。
  try {
    stream = open(startedAt);
  } catch (err) {
    errors.report(err as Error);
  }

  function ensureCurrent(now: Date): fs.WriteStream {
    const ymd = ymdUtc(now);
    if (ymd !== currentYmd || stream === null) {
      try { stream?.end(); } catch { /* noop */ }
      // open が投げても終了済み stream を残さない。 残すと以降の write が
      // ERR_STREAM_WRITE_AFTER_END を出し続け、 開き直しに入れなくなる。
      stream = null;
      stream = open(now);
      currentYmd = ymd;
    }
    return stream;
  }

  return {
    serviceCode,
    logsDir,
    currentFile() {
      return dayFile(logsDir, serviceCode, new Date());
    },
    write(input: WriteInput) {
      if (closed) return;
      const now = new Date(input.ts ?? Date.now());
      const rec: LogRecord = {
        ts: now.getTime(),
        level: input.level ?? 'info',
        service: serviceCode,
        channel: input.channel ?? 'app',
        msg: input.msg,
        pid: input.pid ?? process.pid,
        ctx: input.ctx,
      };
      const line = serialize(rec);
      try {
        const s = ensureCurrent(now);
        s.write(line, (err) => {
          if (err) errors.report(err);
          else if (stream === s) errors.recovered();
        });
      } catch (err) {
        errors.report(err as Error);
      }
    },
    async flush() {
      // WriteStream は flush API がない (drain で代用)。 ここでは noop。
      // close 時にバッファは flush される。
    },
    async close() {
      if (closed) return;
      closed = true;
      const closing = stream;
      stream = null;
      if (!closing || closing.closed) return;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          closing.off('finish', done);
          closing.off('close', done);
          closing.off('error', done);
          resolve();
        };
        // 開けないstreamはfinishに到達しないため、error/closeでも完了する。
        closing.once('finish', done);
        closing.once('close', done);
        closing.once('error', done);
        try { closing.end(); } catch (err) {
          errors.report(err as Error);
          closing.destroy();
          done();
        }
      });
    },
  };
}

function openStream(
  logsDir: string,
  serviceCode: string,
  when: Date,
  onError: (err: Error) => void,
): fs.WriteStream {
  fs.mkdirSync(serviceDir(logsDir, serviceCode), { recursive: true });
  const file = dayFile(logsDir, serviceCode, when);
  const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  // **これが無いとサービスが落ちる。** WriteStream の書き込み失敗は同期例外では
  // なく 'error' イベントで来る。 未処理の 'error' は uncaught exception になるので、
  // write() を try で囲んでも守れない。
  //
  // Windows では別プロセスが同じ日付ファイルを掴んでいると EPERM になる。 並行して
  // 走る委託がすべて同じファイルへ追記するため、 並行度が上がると起きる
  // (Concordia の委託が着手前に落ちた実例: Memoria #2030)。
  stream.on('error', onError);
  return stream;
}
