# Vestigium / dev-process

Vestigium 自体は **常駐 service ではなくライブラリ**。 「dev server を起動」 概念は
無い。 サービス側に組込んでもらう前提。

ただし以下のケースで standalone 起動する:

## 1. CLI を試す

```bash
cd E:/Document/Ars/Vestigium
npm run build
node dist/cli/vestigium.js list
node dist/cli/vestigium.js tail <service> -n 50
```

## 2. テスト

```bash
npm test        # vitest run (全 25 テスト)
npm run typecheck
```

## 3. サービスに組込む

各 service の起動部 (例: Cernere `src/server.ts`) で:

```ts
import { install } from '@ludiars/vestigium';

const vestigium = install({ serviceCode: 'cernere', captureConsole: true });

process.on('SIGTERM', async () => {
  await vestigium.shutdown();
});
```

## 4. Concordia 連携確認

1. Vestigium が吐いたログ dir を `Concordia/catalog/services.yaml` の
   `log_path` に書く
2. Concordia を再起動 (`npm run dev`)
3. Concordia の `/api/v1/services/<code>/logs/recent` で取得できることを確認
4. AI session で MCP tool `vestigium_tail` が動くことを確認

## ログ自分自身

Vestigium 自身は `pino` の default で stderr に warning を吐く程度。 自前
JSONL ファイルは作らない (chicken & egg)。
