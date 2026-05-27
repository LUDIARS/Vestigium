# Vestigium (Vg)

> LUDIARS サービス横断のログ収集ライブラリ。 各サービスに組込んで JSONL ファイルに
> ログを吐き、 Concordia (統合 monitor) が file-tail で拾ってエラーをタスク化、
> AI エージェントは MCP 越しに必要な service のログを引ける。

- npm: `@ludiars/vestigium`
- standalone CLI: `npx vestigium tail <service>`
- ファイル仕様 / 詳細: [DESIGN.md](./DESIGN.md)

## 構成

```
service A ──┐
service B ──┼──► <logsDir>/<code>/<YYYY-MM-DD>.jsonl
service C ──┘                  │
                               ├──► Concordia file-tail → error-detector → error_tasks
                               └──► AI エージェント (Concordia 同梱 MCP server)
```

## 使い方 (service 側)

```ts
import { install } from '@ludiars/vestigium';
import pino from 'pino';

const vestigium = install({
  serviceCode: 'cernere',
  retentionDays: 14,
  captureConsole: true,   // console.log/error を hook
  pinoTransport: true,    // pino logger を一緒に流す
});

// pino 例
const logger = pino({}, vestigium.pinoDestination);
logger.info({ req_id: 'abc' }, 'boot complete');

// シャットダウン
await vestigium.shutdown();
```

低レベル API:

```ts
import { createWriter, sweep } from '@ludiars/vestigium';

const w = createWriter({ serviceCode: 'cernere' });
w.write({ level: 'info', msg: 'hi', ctx: { trace_id: 'xyz' } });
await w.close();

sweep({ retentionDays: 7 }); // 強制 sweep
```

子プロセスの stdout/stderr を流す:

```ts
import { spawn } from 'node:child_process';
import { createWriter } from '@ludiars/vestigium';
import { redirectChild } from '@ludiars/vestigium/sdk';

const child = spawn('node', ['worker.js']);
const writer = createWriter({ serviceCode: 'cernere-worker' });
redirectChild(child, { writer });
```

## CLI

```bash
npx vestigium list                       # service 一覧
npx vestigium tail cernere -n 50         # 当日ログ追跡 (日付境界で auto-roll)
npx vestigium recent cernere --level error,warn
npx vestigium search cernere actio --pattern "ECONNRESET"
npx vestigium sweep --retention 14       # 古いログ削除
```

## Config

| Key | Default | 説明 |
|-----|---------|------|
| `serviceCode` | (必須) | dir 名。 `^[a-z0-9][a-z0-9_-]{0,63}$` |
| `logsDir` | `$VESTIGIUM_LOGS_DIR` or `<cwd>/logs` | 親 dir |
| `retentionDays` | `14` | 過ぎたら sweeper が削除。 `0` で無効 |
| `captureConsole` | `false` | `console.*` を hook |
| `pinoTransport` | `false` | pino destination を expose |
| `sweepIntervalMs` | `3600000` (1h) | 周期 sweep |

env `VESTIGIUM_LOGS_DIR` で global 上書き可。

## monitor 統合 (Concordia)

`Concordia/catalog/services.yaml` に `log_path` を追加すると Concordia は
file-tail でその dir を監視し、 既存の error_rules で error_tasks を作る。

```yaml
- code: cernere-backend-dev
  ...
  log_path: E:/Document/Ars/logs/cernere
```

MCP server は Concordia 同梱:

```jsonc
// .claude/mcp_servers.json
{
  "vestigium": {
    "command": "node",
    "args": ["E:/Document/Ars/Concordia/dist/mcp/vestigium-server.js"]
  }
}
```

提供 tool: `vestigium_list_services` / `vestigium_tail` /
`vestigium_search` / `vestigium_recent_errors`。

## ライセンス

UNLICENSED (LUDIARS 内部)。
