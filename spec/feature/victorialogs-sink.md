# VictoriaLogs へのログ書き出し

Actio `actio:7b048979-f529-4936-bf65-031cb31327ea`

## 入力と送信

`vestigium-sink --url <origin> [--watch] [--logs-dir <path>]` が、通常のログ書き込みと独立して既存 JSONL を読む。URL は `VESTIGIUM_VICTORIALOGS_URL` でも指定できる。ログルートは `--logs-dir`、`VESTIGIUM_LOGS_DIR`、現在のディレクトリの `logs` の順で決まる。既定では一巡で終了し、`--watch` は一巡後に 5 秒空けて再走査する。

| 入力パス | `service` | `kind` | `_time` |
| --- | --- | --- | --- |
| `<code>/YYYY-MM-DD.jsonl` | ディレクトリ名 | `service` | `ts`（epoch ms）、`timestamp`、`time`（後二者は ISO 8601）の順で有効な時刻 |
| `contracts.jsonl`、`archive/contracts-YYYY-MM-DD.jsonl` | `augur` | `contract` | `ctx.observed_at`、`time`、`ts` の順で有効な時刻 |
| `contracts-actio-YYYY-MM-DD-<id>.jsonl` | `actio` | `contract` | Augur と同じ |

サービスログの本文は `msg`、`event`、`message` の順で最初の文字列を使う。行の `service` はディレクトリ名と一致させる。有効な時刻または本文を欠く行は診断して読み飛ばす。契約ログの本文は `msg` を使う。

正規化した UTF-8 JSONL を `POST /insert/jsonline` に送る。リクエストの設定は `_time_field=_time`、`_msg_field=_msg`、`_stream_fields=service,kind`。時刻は UTC の ISO 8601 に統一する。レベル、チャネル、契約 ID（`ctx.contract` から `contract_id` に昇格）などは検索フィールドとする。共有 Augur ログは記録元サービスを一意に特定できないため `service=augur` とする。ログと既存の `ctx` を送るので、機微情報の除去は引き続き記録元が行う。認証情報付き URL や転送先からのリダイレクトは拒否する。配備時はローカル Excubitor catalog のループバック URL を使う。

## 再開とローテーション

- ファイルの走査開始時点の長さまでを、入力・出力各 1 MiB 以下に分けて読む。改行で確定した行だけ処理し、書き込み途中の末尾は次の走査で読む。形式不正な行はファイル名とバイト範囲を診断に出して読み飛ばす。上限を超える行は位置を進めず、そのファイルを診断する。
- 走査中の診断は stderr と宛先別の状態ディレクトリにある `diagnostics-YYYY-MM-DD.jsonl`（UTC 日付）に出す。形式不正行の診断は `ctx.source`、処理したバッチの `ctx.from_byte` と `ctx.to_byte_exclusive`（10 進バイト位置）、`ctx.invalid_rows` を記録する。入力行本文は含めない。状態ディレクトリ内の診断は送信対象から外れる。ファイルへの追記に失敗した場合は stderr へ通知する。
- 入力ルート直下の `.vestigium-victorialogs/` に、宛先とファイルの識別子ごとに確定済みバイト位置を保存する。通常の rename・ハードリンクによる Augur の日次ローテーションでは同じ識別子を引き継ぐ。ファイルを作り直した場合は別の識別子で先頭から読む。切り詰めが確定位置より短くなった場合も先頭から読む。
- 宛先ごとのチェックポイントディレクトリで `.lock` を共有不可で開き、同じログルートと宛先の同時実行を拒否する。プロセスが終了すると OS がロックを解放する。
- HTTP 2xx を読み終えた後に一時ファイルを同期して確定位置を置き換える。タイムアウトや送信失敗では位置を維持し、次回の走査で再送する。2xx 到達後に位置を保存できなかった場合や、Augur が競合時に既存アーカイブへ内容をコピーした場合は重複し得る。VictoriaLogs に書き込みと位置保存をまとめるトランザクションはないため、通常の再起動での再送防止と、障害時に未送信データを飛ばさないことを優先する。
- sink は入力ファイルを削除しない。送信済みの日付を含め、既存のサービスログ、Augur の保管期限と Parquet 化を維持する。保持短縮は、取り込みの遅延・拒否件数とバックアップを運用で確認した後に別途決める。既存の保管期限を超える停止では、元ファイルが失われる前に運用側が保全する必要がある。圧縮済みファイルと Parquet はこの処理の対象外。
- VictoriaLogs は保持範囲外の行などを拒否することがある。HTTP 2xx はバッチの応答で、行ごとの保存証明ではない。保持短縮を検討する際は `vl_rows_dropped_total` と `vl_http_errors_total` も照合する。

## Windows x64 への配備

公式リリースの [VictoriaLogs v1.54.0 Windows amd64](https://github.com/VictoriaMetrics/VictoriaLogs/releases/tag/v1.54.0) を使用する。Vestigium 本体 checkout で `node scripts/site/setup-victorialogs.mjs` を実行すると、公開リリースの ZIP と実行ファイルを公式 SHA-256 で照合し、`.local/victorialogs/` に実行ファイルを配置する。セットアップは再実行でき、既存データや別バージョンの実行ファイルは上書きしない。配布元へのアクセスはセットアップ時のみ。配布元にログ、環境変数、認証情報は送らない。

Excubitor の catalog は `127.0.0.1:9428`、データ領域 `.local/victorialogs/data`、保持 7 日（`-retentionPeriod=7d`）を宣言する。設定のエクスポート・インポートを伴う拠点移行は別工程として扱う。起動の際はセットアップ済みの実行ファイルを Excubitor が直接実行する。明示的に起動するまで自動起動しない。

`vestigium-sink` は VictoriaLogs に依存し、catalog の `provides` で注入される `VESTIGIUM_VICTORIALOGS_URL` に `${ARS_ROOT}/logs` から継続送信する。配備時は [README の手順](../../README.md) で本体 checkout をビルドし、VictoriaLogs の起動を確認してから Excubitor で `vestigium-sink` を起動する。初回の起動は運用担当者が行い、稼働中の異常終了は Excubitor が再起動する。定常運用はこのサービス一つに任せ、同じログルート・宛先を手動で扱う場合は管理下の sink が停止してから CLI を実行する。

## Revisor の遡及取り込み

2026-11-25 の初回取り込みでは、`timestamp` と `event` を使う Revisor 行が旧版で不正行としてスキップされ、読み取り位置が進んだ。11 月 26 日 08:31 JST の読み取り照会では C++ 版で 1,733 件が取り込まれており、最古の行は `2026-11-25T14:14:06.078Z` だった。11 月 25 日の元ファイルにはその行より前に 3,385 行ある。C++ 版の起動直後に 0 件だった時点の診断は未確認。

1. VictoriaLogs を照会し、送信による重複がない欠落時刻区間を確認する。11 月 19 日〜25 日分の例では `--since 2026-11-19T00:00:00Z --before 2026-11-25T14:14:06.078Z` を指定する。終了時刻は含めない。
2. `py scripts/site/prepare-revisor-replay.py --logs-root <共有ログルート> --replay-root <既存の親ディレクトリ内の新規パス> --since <欠落開始> --before <欠落終了> --duckdb <導入済みduckdb.exe>` を実行する。保持 7 日を越えた行は対象外。日付ごとに JSONL または Parquet の片方が必要で、日ごとの件数を出力する。Parquet がある場合だけ、ローカルの Parquet と JSON 対応の DuckDB CLI を使う。拡張機能の自動導入と自動ロードは無効にする。
3. 件数を確認し、`vestigium-sink --url <origin> --logs-dir <新規パス>` を一巡だけ実行する。このプロセスの `VESTIGIUM_LOGS_DIR` には、契約ログ用に新規パス配下の隠しディレクトリ（例 `.contracts`）を指定する。失敗時は同じ新規パスを再利用して確定位置から再開する。共有ログ側のカーソルは初期化しない。

## 受け入れ条件

- C-1 createInsertUrl(origin): VictoriaLogs の JSONL 挿入先に時刻、本文、低カーディナリティのストリームフィールドを指定する
- C-2 resolveServiceAliases(row): サービスログの ts・timestamp・time と msg・event・message を優先順に解決し、必要な値を欠く行を読み飛ばす
- C-3 resetCheckpoint(store, key): 切り詰め検出後は確定位置を 0 に保存して先頭から再開する
- C-4 formatDiagnostic(diagnostic, epochMs): 診断種別と入力位置の範囲を JSONL に記録し、元の行データを含めない
- HTTP 失敗後の再送、成功後の再走査と日次 rename、UTF-8 の部分行、入力ファイルの保持を回帰テストで確認する。

## C++ 版への移行

C++ 版の処理は、配備済み Portus の HTTP・JSON・SHA-256 と、インストール済み Lorica を使う。ビルドには VS 2026 の C++23 と CMake 4.2 以上を使う。CMake に `PORTUS_SOURCE_DIR` で Portus の `cpp/` の場所を指定し、`CMAKE_PREFIX_PATH` で Lorica のインストール先を指定する。設定・ビルド時に依存の取得処理は行わない。送信時の通信先は設定された VictoriaLogs の HTTP(S) オリジンのみで、認証情報付き URL を拒否し、応答のリダイレクトには従わない。

Portus の `FileFollower` が、rename を妨げずに開いたハンドルから Windows ファイル ID と走査範囲を取得し、バイト位置を指定して読み込む。互換性のための生成時刻は別の属性ハンドルから取得し、ファイル ID が読み取りハンドルと一致した場合に使う。

Windows NTFS 上の既存チェックポイントは、宛先の正規化済みオリジンと、Node の `dev:ino:birthtimeNs` をそれぞれ UTF-8 の SHA-256 にしたディレクトリ名とファイル名で引き継ぐ。ファイルの中身は 10 進バイト位置と末尾 LF。配備の切り替え時は、旧プロセスを停止し、既存チェックポイントと実ファイルの対応を照合してから新しい実行ファイルを起動する。
