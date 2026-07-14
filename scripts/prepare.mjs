// npm prepare エントリ。 dist が src より新しければ tsc をスキップする。
//
// 背景: 親プロジェクト (Concordia) は本パッケージを file: + install-links で取り込み、
// 親の `npm ci` が pack 時に prepare を再実行する。 このとき親の node_modules は
// 展開中で、 tsc が書きかけの型定義 (例: buffer/index.d.ts) を読んで構文エラーに
// なるレースがあった (2026-07-02 CI 実害)。 親 CI は直前の「Build submodules」で
// dist を必ず新鮮にするため、 dist が新しい限り prepare での再コンパイルは不要。
// src を編集した開発フローでは src の方が新しくなるので従来どおりビルドが走る。

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "index.js");

function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (e.isFile()) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

if (existsSync(distEntry)) {
  const distMtime = statSync(distEntry).mtimeMs;
  const srcMtime = newestMtime(join(root, "src"));
  if (distMtime >= srcMtime) {
    console.log("[vestigium prepare] dist is fresh; skipping tsc");
    process.exit(0);
  }
}

execSync("npx tsc -p tsconfig.json", { stdio: "inherit", cwd: root });
