# Vestigium / CLAUDE memo

- 略称: Vg
- 主要 doc: [README.md](./README.md) / [DESIGN.md](./DESIGN.md)
- 立ち位置: LUDIARS サービス横断のログ収集ライブラリ (writer + reader + CLI)
- monitor 側 (file-tail / error detection / MCP server) は **Concordia** 側に住む
  - Concordia の `src/observability/log/file-tail.ts`
  - Concordia の `src/observability/log/vestigium-reader.ts` (spec の subset 再実装)
  - Concordia の `src/mcp/vestigium-server.ts`
  - Vestigium の JSONL spec を変えたら Concordia 側 reader と同期する

## 開発ルール

- 全変更は feat ブランチ + PR (LUDIARS 共通)
- ESM + TypeScript strict + vitest
- writer は I/O 失敗で投げない (サービス本体を巻き込まないため)
- service code は `^[a-z0-9][a-z0-9_-]{0,63}$` (path traversal 防止)
- JSONL 仕様変更は DESIGN.md §2.2 を更新し、 Concordia 側 reader にも反映

## 触らないもの

- `@ludiars/vestigium` への上位依存は持たない (循環防止)
- Concordia 側で reader を再実装してる理由は cross-repo dep 回避
  ([[feedback_cross_repo_path_dep]])。 spec drift 注意

## 起動 / 確認

```bash
npm test           # vitest (全 25 テスト)
npx vestigium list # logs dir 配下を一覧
```
