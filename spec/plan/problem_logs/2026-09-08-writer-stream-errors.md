# ログ出力先の障害でサービスを終了させない

- Date: 2026-09-08
- Area: src/writer.ts

## Evidence
Rv1379の修正元2dcc7d99633fb213173205352a1746dd7c83ee51は、Memoria #2030に関連するログ書き込み失敗を扱う。現行mainではcreateWriteStreamのerrorハンドラがなく、同期writeのtry/catchだけでは非同期エラーを処理できない。旧PRはtarget domain未設定で審査が停止した。

## Fix Requirements
出力先作成失敗と非同期streamエラーを警告として扱い、次のwriteで再試行する。不正なserviceCodeは従来どおり拒否する。旧streamの遅延エラーで新streamを破棄せず、closeはエラー時も完了する。同一エラーの警告抑制は書き込み成功後に解除する。

## Verification
Rv1551でもdomain未設定となった原因は、所属パターンが`^src/`で始まる一方、Anatomiaが絶対パスへ正規表現を適用することだった。対象ファイルを限定したまま`(^|/)src/`へ修正する。

旧PRの出力先がディレクトリである場合と、親ディレクトリを作成できない場合の回帰テストを引き継ぐ。実行結果はRevisorの登録テストで確認する。現行mainのlog-writing定義にwriterと対応テストが所属し、DESIGN.mdへ紐付くことを確認する。
