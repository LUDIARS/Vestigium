// npm prepare エントリ。 dist が src より新しければ tsc をスキップする。
//
// 背景: 親プロジェクト (Concordia) は本パッケージを file: + install-links で取り込み、
// 親の `npm ci` が pack 時に prepare を再実行する。 このとき親の node_modules は
// 展開中で、 tsc が書きかけの型定義 (例: buffer/index.d.ts) を読んで構文エラーに
// なるレースがあった (2026-07-02 CI 実害)。 親 CI は直前の「Build submodules」で
// dist を必ず新鮮にするため、 dist が新しい限り prepare での再コンパイルは不要。
// src を編集した開発フローでは src の方が新しくなるので従来どおりビルドが走る。
//
// tsc の解決について: かつて `npx tsc` を使っていたが、 これは devDependencies が
// 未インストールの状態で失敗する。 submodule を fresh checkout しただけの親
// (Lictor) が `npm install` すると、 npm は file: 依存の prepare をここで走らせる
// 一方、 本パッケージの node_modules はまだ空なので local tsc が無く、 npx は
// 「This is not the tsc command you are looking for」 で終わる。 親の install が
// そこで失敗し、 dist が無いまま放置されると、 親は `main` が指す dist/index.js を
// 解決できなくなる (2026-08-01 実障害: Lictor の CLI が全滅し、 Discord への返信
// リレーが停止した)。 prepare は自分をビルドできる責任を持つので、 local tsc が
// 無ければ devDependencies を自分で入れてから使う。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "index.js");

// 自前の `npm install` が prepare を再帰的に呼ぶ。 install 済みで来た 2 周目は
// bootstrap を試みず、 tsc が無ければ素直に失敗させる (無限ループ防止)。
const BOOTSTRAP_FLAG = "VESTIGIUM_PREPARE_BOOTSTRAPPED";

function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (e.isFile()) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/**
 * tsc の JS エントリ (node_modules/typescript/bin/tsc)。 無ければ undefined。
 * .bin の shim ではなく実体を指すのは、 shim が Windows では .cmd で shell 起動を
 * 強いられるため。 実体なら `node <path>` で shell 無しに起動できる。
 */
function localTsc() {
  const entry = join(root, "node_modules", "typescript", "bin", "tsc");
  return existsSync(entry) ? entry : undefined;
}

/**
 * shell: true は command / args を cmd.exe に文字列として渡すため、 空白や `&` を
 * 含むパスが壊れる。 リテラルの command (npm) にだけ使い、 パスを渡す tsc 起動は
 * shell 無し (process.execPath + JS エントリ) で行う。
 */
function run(command, args, label, { shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    // Windows の npm.cmd は shell 経由でしか起動できない。
    // Node 20.12+ は shell:false での .cmd 起動を EINVAL で弾く。
    // 引数はすべてこのファイル内のリテラルなので shell 展開の危険は無い。
    shell,
    // 親シェルが NODE_ENV=production だと devDependencies (typescript) が
    // 落ちて、 入れ直したのに tsc がまだ無い状態になる。
    env: { ...process.env, NODE_ENV: "development", [BOOTSTRAP_FLAG]: "1" },
  });
  if (result.error) {
    throw new Error(`[vestigium prepare] ${label} を起動できません`, { cause: result.error });
  }
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    throw new Error(`[vestigium prepare] ${label} failed (${reason})`);
  }
}

if (existsSync(distEntry)) {
  const distMtime = statSync(distEntry).mtimeMs;
  const srcMtime = newestMtime(join(root, "src"));
  if (distMtime >= srcMtime) {
    console.log("[vestigium prepare] dist is fresh; skipping tsc");
    process.exit(0);
  }
}

let tsc = localTsc();
if (!tsc && !process.env[BOOTSTRAP_FLAG]) {
  console.log("[vestigium prepare] local tsc not found; installing devDependencies");
  run(process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--include=dev", "--no-audit", "--no-fund"], "npm install",
    { shell: process.platform === "win32" });
  // 入れ子の install が走らせた prepare が既にビルドを終えていることがある。
  if (existsSync(distEntry)) {
    console.log("[vestigium prepare] dist built during bootstrap; skipping tsc");
    process.exit(0);
  }
  tsc = localTsc();
}

if (!tsc) {
  throw new Error(
    "[vestigium prepare] tsc が見つかりません。 `npm install --include=dev` を実行してください。",
  );
}

run(process.execPath, [tsc, "-p", "tsconfig.json"], "tsc");
