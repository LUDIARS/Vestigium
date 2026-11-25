# VictoriaLogs へのログ書き出し

Actio `actio:7b048979-f529-4936-bf65-031cb31327ea`

## 入力と送信

`vestigium sink --url <origin> [--watch] [--logs-dir <path>]` が、通常のログ書き込みと独立して既存 JSONL を読む。Node.js 20 以上の標準 HTTP 機能を使う。URL は `VESTIGIUM_VICTORIALOGS_URL` でも指定できる。同じログルートと宛先に対して、運用側で実行を一つに直列化する。既定では一巡で終了し、`--watch` は一巡後に 5 秒空けて再走査する。

| 入力パス | `service` | `kind` | `_time` |
| --- | --- | --- | --- |
| `<code>/YYYY-MM-DD.jsonl` | ディレクトリ名 | `service` | `ts`（epoch ms） |
| `contracts.jsonl`、`archive/contracts-YYYY-MM-DD.jsonl` | `augur` | `contract` | `ctx.observed_at`、`time`、`ts` の順で有効な時刻 |
| `contracts-actio-YYYY-MM-DD-<id>.jsonl` | `actio` | `contract` | Augur と同じ |

正規化した UTF-8 JSONL を `POST /insert/jsonline` に送る。リクエストの設定は `_time_field=_time`、`_msg_field=_msg`、`_stream_fields=service,kind`。ISO UTC の時刻と `msg` を送り、レベル、チャネル、契約 ID（`ctx.contract` から `contract_id` に昇格）などは検索フィールドとする。共有 Augur ログは記録元サービスを一意に特定できないため `service=augur` とする。ログと既存の `ctx` を送るので、機微情報の除去は引き続き記録元が行う。認証情報付き URL や転送先からのリダイレクトは拒否する。配備時はローカル Excubitor catalog のループバック URL を使う。

## 再開とローテーション

- ファイルの走査開始時点の長さまでを、入力・出力各 1 MiB 以下に分けて読む。改行で確定した行だけ処理し、書き込み途中の末尾は次の走査で読む。形式不正な行はファイル名とバイト範囲を診断に出して読み飛ばす。上限を超える行は位置を進めず、そのファイルを診断する。
- 入力ルート直下の `.vestigium-victorialogs/` に、宛先とファイルの識別子ごとに確定済みバイト位置を保存する。通常の rename・ハードリンクによる Augur の日次ローテーションでは同じ識別子を引き継ぐ。ファイルを作り直した場合は別の識別子で先頭から読む。切り詰めが確定位置より短くなった場合も先頭から読む。
- HTTP 2xx を読み終えた後に一時ファイルを同期して確定位置を置き換える。タイムアウトや送信失敗では位置を維持し、次回の走査で再送する。2xx 到達後に位置を保存できなかった場合や、Augur が競合時に既存アーカイブへ内容をコピーした場合は重複し得る。VictoriaLogs に書き込みと位置保存をまとめるトランザクションはないため、通常の再起動での再送防止と、障害時に未送信データを飛ばさないことを優先する。
- sink は入力ファイルを削除しない。送信済みの日付を含め、既存のサービスログ、Augur の保管期限と Parquet 化を維持する。保持短縮は、取り込みの遅延・拒否件数とバックアップを運用で確認した後に別途決める。既存の保管期限を超える停止では、元ファイルが失われる前に運用側が保全する必要がある。圧縮済みファイルと Parquet はこの処理の対象外。
- VictoriaLogs は保持範囲外の行などを拒否することがある。HTTP 2xx はバッチの応答で、行ごとの保存証明ではない。保持短縮を検討する際は `vl_rows_dropped_total` と `vl_http_errors_total` も照合する。

## Windows x64 への配備

公式リリースの [VictoriaLogs v1.54.0 Windows amd64](https://github.com/VictoriaMetrics/VictoriaLogs/releases/tag/v1.54.0) を使用する。Vestigium 本体 checkout で `node scripts/site/setup-victorialogs.mjs` を実行すると、公開リリースの ZIP と実行ファイルを公式 SHA-256 で照合し、`.local/victorialogs/` に実行ファイルを配置する。セットアップは再実行でき、既存データや別バージョンの実行ファイルは上書きしない。配布元へのアクセスはセットアップ時のみ。配布元にログ、環境変数、認証情報は送らない。

Excubitor の catalog は `127.0.0.1:9428`、データ領域 `.local/victorialogs/data`、保持 7 日（`-retentionPeriod=7d`）を宣言する。設定のエクスポート・インポートを伴う拠点移行は別工程として扱う。起動の際はセットアップ済みの実行ファイルを Excubitor が直接実行する。明示的に起動するまで自動起動しない。

## 受け入れ条件

- C-1 createInsertUrl(origin): VictoriaLogs の JSONL 挿入先に時刻、本文、低カーディナリティのストリームフィールドを指定する
- HTTP 失敗後の再送、成功後の再走査と日次 rename、UTF-8 の部分行、入力ファイルの保持を回帰テストで確認する。
