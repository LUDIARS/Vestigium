# Vestigium — 設計書

> LUDIARS サービス横断のログ収集ライブラリ。 各サービスに組込んで JSONL に吐き、
> 統合アプリ (Concordia) が tail してエラー検知、 AI エージェントが MCP 経由で
> 必要なサービスのログを subscribe できる。

- 略称: **Vg**
- npm package: `@ludiars/vestigium`
- repo: `LUDIARS/Vestigium`
- 立ち位置: ライブラリ + standalone CLI (sweep / tail) + ファイル仕様のオーナー

## 1. 背景

旧 Excubitor / 現 Concordia observability は「中央アプリが各サービスを spawn
して stdout を捕捉」 する scheme だった (`process-bridge.ts` + `manager.ts`)。
これは以下の制約があった:

- サービスを Concordia 経由で起動しないとログが取れない
- Concordia 停止中はログがロストする
- サービス自身が独立に動いている (Docker / 別ターミナル / cron) ケースを拾えない

Vestigium はこれを反転させる:

- **サービスが自分でログをファイル (JSONL) に吐く** — Vestigium はそのための
  hook ライブラリと writer/rotator を提供
- **統合アプリは file-tail でログを読む** — Concordia の log bus は file source
  を新たに受け、 既存の error_detector はそのまま再利用
- **AI エージェント** は Concordia 同梱の MCP server 越しにログを読める

## 2. ログファイル仕様 (file-format スペック、 単独で実装可能)

### 2.1 ディレクトリレイアウト

```
<logsDir>/
  <service-code>/
    YYYY-MM-DD.jsonl         # その日のログ (UTC 境界)
    YYYY-MM-DD.jsonl.gz      # 圧縮済 (option)
    .meta.json               # 最終 rotate 時刻 / 保持件数 (任意)
```

- `logsDir` のデフォルトは `process.env.VESTIGIUM_LOGS_DIR` → 無ければ
  `<repoRoot>/logs/` (`process.cwd()` 起点)
- `service-code` は LUDIARS PROJECT-CODES の小文字 (`cernere`, `actio`, ...)
- 1 ファイル 1 日。 UTC 0:00 を境に新しいファイルへ
- 圧縮は P2 (本 PR では未実装)。 retention sweep だけ実装

### 2.2 JSONL 1 行スキーマ

```jsonc
{
  "ts": 1779843000123,            // epoch ms (number)
  "level": "info",                // "trace"|"debug"|"info"|"warn"|"error"|"fatal"
  "service": "cernere",           // 同じ dir 名と一致 (sanity)
  "channel": "stdout",            // "stdout"|"stderr"|"app"|"llm" (app = SDK 経由, llm = LLM 呼び出し専用)
  "msg": "boot complete",         // メッセージ本文 (改行は \n でエスケープ済み)
  "pid": 12345,                   // 任意
  "ctx": { "req_id": "abc" }     // 任意 (任意 JSON object)
}
```

- 1 行 = JSON.stringify 1 個 + "\n"。 改行は msg 内では `\n` literal で持つ
- 64KB 超は `msg` を切り詰め (末尾に `…(truncated N)`)
- writer は failure-safe: I/O エラーは process.stderr に warning を出すが
  サービス本体を落とさない

### 2.3 retention

- `retentionDays` (default 14) を過ぎたファイルは sweeper が削除
- sweeper は writer の startup 時 1 回 + 1 時間ごと
- `retentionDays = 0` で sweep 無効 (永続化)

## 3. service 側 SDK

### 3.1 install API (推奨)

```ts
import { install } from '@ludiars/vestigium';

const vestigium = install({
  serviceCode: 'cernere',     // 必須
  logsDir: undefined,          // 省略時 env or cwd/logs
  retentionDays: 14,
  captureConsole: true,        // console.log/error をフック
  pinoTransport: true,         // pino logger を返す
});

vestigium.logger.info({ req_id: 'abc' }, 'boot complete');
await vestigium.shutdown();    // graceful close
```

### 3.2 個別 API

- `createWriter({serviceCode, logsDir})` — 低レベル writer
- `createPinoTransport({serviceCode})` — pino transport (子 process なし)
- `hookConsole({writer})` — global console を hook
- `redirectChild(child, {serviceCode, channelStdout, channelStderr})` —
  child_process の stdout/stderr を line-by-line に Vestigium へ流す

### 3.3 spawn 経路 (Concordia が外部 process を spawn する場合)

Concordia の manager.ts は引き続き spawn するが、 spawn 時に
`VESTIGIUM_LOGS_DIR` と `VESTIGIUM_SERVICE_CODE` を env で渡す方針。
spawn される側 (Node) は起動時に `install()` を呼ぶだけで file 出力が成立する。

spawn される側が install を呼んでいない場合の fallback として、 Concordia 側で
`redirectChild()` を使って外側から JSONL を書く (移行期の互換)。

## 4. monitor (Concordia 側改修)

### 4.1 file-tail bridge (新規)

`Concordia/src/observability/log/file-tail.ts`:

- catalog の各 service の `log_path` (ディレクトリ) を watch
- 当日 file を tail (`fs.watch` + 末尾 offset 管理)
- 日付境界で次の YYYY-MM-DD.jsonl にスイッチ
- 1 行ごとに JSON parse → 既存 `bus.publish({service_code, channel, ts, line})` へ
- 既存の `error-detector.ts` はそのまま再利用 (bus 経由のため)

### 4.2 process-bridge の扱い

- v0.7 の段階では process-bridge も残す (env で off 可能)
- catalog の service に `log_path` がある場合は file-tail を、 無い場合は
  従来 process-bridge を使う (移行期)
- 全サービス Vestigium 移行後に process-bridge は別 PR で削除

### 4.3 catalog 拡張 (`catalog/services.yaml`)

```yaml
- code: cernere-backend-dev
  ...
  log_path: E:/Document/Ars/logs/cernere   # ← 追加 (省略時は process-bridge fallback)
```

## 5. MCP server (Concordia 同梱)

`Concordia/src/mcp/vestigium-server.ts` — stdio MCP server。 起動コマンドは
`node dist/mcp/vestigium-server.js` で、 各 AI session の `mcp add` から接続。

### 5.1 tools

| tool | params | returns |
|------|--------|---------|
| `vestigium_list_services` | (none) | `{services: [{code, log_path, last_line_at}]}` |
| `vestigium_tail` | `{service, lines?}` (default 200) | `{lines: [{ts, level, msg, ...}]}` |
| `vestigium_search` | `{services: string[], pattern, since?, limit?}` | matched lines (回り込み 24h まで) |
| `vestigium_recent_errors` | `{services?: string[], limit?}` | `error|fatal` level 行のみ |

### 5.2 認可

- MCP は localhost stdio で、 起動者 (Claude Code / Codex) がそのまま信頼境界
- 認証は当面なし。 Cernere project-token 化は v0.2

## 6. CLI (standalone)

`npx vestigium tail <service> [-n 200]` — 当日 file を follow
`npx vestigium list` — log dir 配下の service 一覧
`npx vestigium sweep [--retention 14]` — 強制 sweep

> Vestigium 単体で動かす想定。 Concordia が止まっていてもログは溜まり、
> CLI で確認できる。

## 7. 段階移行

1. (本 PR) Vestigium 実装 + Concordia file-tail 追加 + MCP server 同梱
2. 主要サービス (Cernere / Memoria / Actio / Schedula) から `install()` を呼んで
   logs/ に吐き始める (別 PR、 各 repo)
3. catalog services.yaml の `log_path` を順次埋める
4. 全サービス移行完了後、 process-bridge を削除 (別 PR)

## 8. 非ゴール (this PR ではやらない)

- ログ圧縮 (gz)
- multi-host (remote tail / SSH 経由)
- Cernere 認証付き MCP
- Web dashboard (Concordia の既存 dashboard をそのまま使う)
- TS 以外の言語の SDK (Rust / C++ は別 issue)

## 9. 依存

- `pino` (peer dep) — pino transport 用
- `zod` — config schema
- `@modelcontextprotocol/sdk` — Concordia 側 MCP server で使用
- dev: `vitest`, `typescript`, `@types/node`

## 10. test

vitest で以下を検証:

- writer: 単一行 / multi-line / 日付境界 / 並行 write の order safety
- rotator: retention 超過ファイル削除 / `retentionDays=0` で無効
- config: zod 解釈 / env 上書き
- sdk: hookConsole が console.log を JSONL に流す / pino transport が level
  を正しく載せる
- file-tail (Concordia 側): YYYY-MM-DD 境界でファイル切替を追従する
