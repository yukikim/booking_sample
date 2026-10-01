# Epic 7 詳細設計：品質確認とリリース準備

実施日：2026-09-30。対象：Story 7.1 / Task 7.1.1〜7.1.4。
README第12章と各Epicの完了条件を期待値とする。ローカル検証の成功は、本番環境や実メール受信の確認を意味しない。

## 1. 検証環境と実行手順

Node.js 22.23.1、Next.js 16.3.5、ローカルPostgreSQL。Next.js同梱のPlaywrightガイドとアクセシビリティガイドを参照した。

既存の統合テストはローカルURL一致ガードを通し、ランダム名の隔離スキーマへmigrationとseedを適用する。終了時にテストサーバー・隔離スキーマ・出力ディレクトリを片付ける。既存publicスキーマのリセット・seed・データ削除は行わない。メールは模擬プロバイダーを使い、実配信しない。

```sh
npm run check
npm run test:db
npm run test:e2e:http
npm run build
# Turbopackが実行環境のポート制限で失敗する場合の別方式の検証
npm run build -- --webpack
```

追加した `test:e2e:http` は auth → member → booking → withdrawal を順番に実行し、失敗した時点で停止する。ブラウザのクリック操作を行うテストではない。`check:release` は静的確認・DB検証・HTTP統合・標準本番ビルドを一括実行し、失敗を成功扱いしない。

## 2. Task 7.1.1：主要フローの通し確認

| 対象 | 再実行した検証 | 結果 |
| --- | --- | --- |
| 管理者・スタッフログイン、スタッフ作成・権限変更 | scripts/verify-auth.ts | 成功 |
| 入会・確認メールの内容とトークン・メール確認・ログイン・再設定 | scripts/verify-member.ts | 成功、模擬配信 |
| 非会員空き検索・予約作成・変更・取消・代理予約 | scripts/verify-booking.ts | 成功 |
| 変更案内の候補・確認後送信・顧客対応・予約変更/取消による解決 | scripts/verify-booking.ts | 成功、模擬配信 |
| 本人退会・強制退会・予約枠解放・復旧・セッション失効 | scripts/verify-withdrawal.ts、verify-member.ts | 成功 |

HTTPリクエストは実際のNext.jsサーバーへ送信し、DB状態も確認する。予約系はテスト用の署名済みセッションを利用し、認証・会員系ではCredentialsログインも検証する。各系統は独立したスキーマで動き、全操作が同じブラウザセッション内で連続する検証ではない。

発見・修正：会員テストに旧見出し「会員ページ」が残っていたため、現行の「マイページ」に合わせた。修正後の会員テストは成功。

残作業：ブラウザによる入会から退会までと管理者・スタッフ操作の全フローE2E。HTTP成功だけでTask全体を完了扱いしない。

## 3. Task 7.1.2：表示と操作

実ブラウザで公開画面を確認。390×844の登録画面で入力・年代選択・ボタン・案内リンクを確認し、documentの横幅390で横方向のはみ出しなし。メール欄からTabで姓欄に移ることを確認した。ログイン画面も390幅で横方向のはみ出しなし、未入力で送信するとメール欄へフォーカスして必須入力を案内する。確認ページはトークンなしの案内を表示し、送信ボタンを無効化する。非会員Web予約画面のメニュー・オプション・日付・備考のラベルをアクセシビリティツリーで確認した。1280×900ではWeb予約のdocument幅が1280で横方向のはみ出しなし。

修正内容：

- 日本語ページのルート言語を `ja` に変更。初期テンプレートのタイトル・説明を予約アプリの内容へ変更。
- 暗い背景に青いリンクを表示する自動ダークモードを外し、既存画面の配色に合わせて明るい背景へ統一。
- `jsx-a11y/label-has-associated-control` をlintエラーとして追加。全srcを検査し成功。

残作業：認証後のマイページ・予約確認/変更/取消・退会、管理画面の全状態でのスマートフォン/PC表示とキーボード操作、実機・スクリーンリーダー確認。全画面検証は未完了。

## 4. Task 7.1.3：認証・権限・情報分離

HTTP統合検証で非会員の予約作成・一覧・詳細を401で拒否。他会員の詳細と画面を404で拒否し、他会員による変更・取消を403で拒否する。会員の管理APIアクセス、操作権限のないスタッフの代理予約・管理操作、異なるOriginからの操作、期限切れ/失効セッションも拒否する。会員確認・再設定トークンは期限切れ・再利用・旧トークンを拒否する。入力・会員状態・権限・競合はDB制約とAPIで再検証する。これらは既存検証の再実行により確認した。

本番srcのログ出力とAPIエラー経路を検索・確認。アプリ独自のエラーは固定のコードを返し、認証loggerは機密情報を含む例外を直接記録しない。今回、会員・予約・退会テストの失敗時にAssertionErrorの全文やレスポンス本文を出力する経路を修正した。例外名とスタックの位置だけを出力し、トークンや会員情報を含み得るメッセージは除く。テストの期待値や詳細はソース内で確認する。

結果：ローカルの認証・権限・本人確認・入力・所有者分離とログ経路の確認を完了。本番ログ基盤、90日保存の実適用、監視と実サービスのエラー収集はStory 7.2の検証対象として残る。

## 5. Task 7.1.4：実行結果と未解決事項

| コマンド | 最終結果 |
| --- | --- |
| npm run check | 成功：Prisma validate/generate・lint・型チェック・単体37件 |
| npm run test:db | 成功：199項目、76 CHECK制約、隔離スキーマ削除 |
| npm run test:auth | 成功 |
| npm run test:member | 成功：古い見出し期待値の修正後に再実行 |
| npm run test:booking | 成功 |
| npm run test:withdrawal | 成功 |
| npm run build | 失敗：TurbopackのCSS処理でポートbindがOperation not permitted |
| npm run build -- --webpack | 成功：最終表示修正後も再実行 |

標準Turbopackビルドは環境制限で未解決。Webpackの成功からTurbopackやVercelでの成功は推定しない。初回DB接続はsandboxの制限で失敗し、ローカル接続が可能な実行で再検証して成功した。

未解決事項：全フローのブラウザE2E、認証後の全画面の表示/操作、実メール受信、本番Cron、本番ログ保存、デプロイ後の動作確認。Task 7.1.3と7.1.4のローカル確認・結果記録は完了。Task 7.1.1と7.1.2は上記の残作業があるため未完了のまま維持する。Story 7.1の完了条件と初期リリース判定はまだ満たさない。

## 6. Story 7.2：環境分離・デプロイ・運用（Task 7.2.1〜7.2.4）

2026-09-30実施。ユーザー回答「未設定。まずリポジトリ内の設定・運用手順を整備する」に従い、Vercel/Neonの作成や本番変更は行わない。手順の全文は[運用手順](operations.md)に記載する。

### 6.1 Task 7.2.1：環境分離と接続設定

開発は既存Docker、検証・本番は別Vercelプロジェクトと別Neon endpointを使う方針。`.env.hosted.example`を追加し、APP_ENV、pooler/direct接続、固定endpoint hostname、HTTPS AUTH_URL、独立した認証/メール/監視秘密値を定義する。

`env:check`はURLのTLS/public schema、endpoint/database一致、pooler/direct区分、固定host一致、秘密値の最低長・使い回し、メール暗号化鍵、管理者パスワード、Previewでのproduction指定、テスト用フラグ混入を検査する。値を出力せず、変数名と失敗理由だけを返す。--file指定時はそのファイルだけを検査し、ローカル.envやshellの値と混ぜない。

VercelのbuildCommandを `npm run build:deploy` に設定する。環境検査→Prisma Client生成→ビルドの順で、migration/seedを実行しない。手元の通常build/checkは従来どおり実行できる。

結果：リポジトリ内の設定と検査を整備。単一設定ファイルの整合性検査であり、異なる環境間のDB分離を証明しない。外部Vercel/Neonでの登録・接続確認は未実施、Task全体は未完了。

### 6.2 Task 7.2.2：migrationとrollback

2026-10-01追記：デプロイはGitHub ActionsのCI/CDを前提とする。通常の本番migrationはCDへ一本化し、リリース責任者が対象SHA・変更・確認結果を管理する。CI成功→同一SHAの検証CD→本番ビルド→バックアップ保管→本番migration→状態/権限確認→Vercel公開→smokeの順とする。production Environmentと固定concurrency group（cancel-in-progress: false）を使い、VercelのGit自動デプロイを停止する。現在のworkflowはCIのみで、CDと外部設定は未実装。具体的な設定要件と本番migrationの6段階の手順は[運用手順第2章](operations.md#2-リリースとmigration)を参照。

検証済みcommitとSQLをバックアップ後に本番へ適用し、その後アプリ公開する。ビルド/Preview/起動時migrationを禁止する。追加変更を先に適用する互換性維持を原則とし、破壊的変更は変更窓と別リリースで扱う。

`db:deployment`は明示的な.envファイル・照合済みexpected-host・status/deploy/bootstrapの指定を要求する。bootstrapは固定管理者行だけを追加し、開発用seedを本番へ流さない。これは実行対象の指定を助けるガードで、担当者による対象照合を代替しない。Prisma 7のstatusは未適用migrationでも終了コード1を返し、現在のラッパーは出力を抑制するため障害と区別できない。CD実装時に事前状態の判別を用意し、汎用エラーを無視してdeployへ進めない。子プロセスtimeoutは120秒で、timeout後も部分適用を確認する。

アプリrollbackとDB復旧を分離する。旧コード互換なら旧Vercelデプロイへ戻す。migration失敗は実スキーマと履歴を照合し、検証した修正のみ適用。データ破損/非互換では隔離DBへ復元し、退会・権限・予約状態を突合してから切り替える。既存本番をreset/restoreで上書きしない。

結果：実行タイミングと失敗時の手順を決定・記載し、Task 7.2.2を完了。外部DBへのmigrationやVercelのrollback実行は未実施。

### 6.3 Task 7.2.3：監視・バックアップ・復旧

- `/api/ops/health`：32文字以上の独立したOPS_SECRETで認証。正常200、期限超過キュー（5分）、24時間以内のFAILED、UNKNOWN、リース切れSENDINGまたはDB障害で503。no-store、宛先/ID/本文/トークンを含まない集計のみ。送信・DB変更はしない。
- `instrumentation.ts`：Next.js同梱guideを参照し、捕捉サーバーエラーのeventとroute種別のみを記録。error本文・headers・具体的なpath/queryを出さない。捕捉済みAPIエラーはステータスと監視で確認。基盤が自動出力するログの機密除去と90日保持は外部設定・実ログ確認が必要。
- `db:backup`：設定検査後のDIRECT_URLでcustom formatのpg_dumpを実行。秘密情報をargvへ出さず、新規0600ファイルへ保存する。35日保持・日次/リリース前取得・暗号化保管の方針を運用手順へ記載。外部保管とschedulerは未設定。
- 復元時隔離処理：全AppSession/AuthTokenを失効し、復元されたPENDING/RETRY_WAIT/SENDINGをUNKNOWNにしてpayloadを消去する。STARTED試行もUNKNOWNにする。バックアップ以降の実送信を再送しない。予約・枠・会員・権限は変更しない。
- `test:recovery`：ローカル接続ガード後、使い捨て2DBへmigration/fixtureを用意し、実pg_dump/pg_restoreを実行。復旧処理の再実行、migration履歴、予約/枠、退会状態、スタッフ権限、セッション/トークン失効、キュー監視、復元後の一意制約を検証。既存publicを保持し、テストDBとdumpを削除する。

即時送信と既存1/5/30分の回復再試行は維持する。恒久/UNKNOWN/期限切れは停止。Cronの毎分設定はプラン条件を確認する。PreviewではVercel Cronが実行されないため、別途入口の確認が必要。

結果：ローカルの復旧演習と監視入口のHTTP検証は成功。外部検証環境の復旧、通知先・ログ保存・暗号化保管・35日保持・日次scheduler・実Resend/Cronは未実施。Task全体は未完了。

### 6.4 Task 7.2.4：公開後確認とREADME

`smoke:deployment`を追加。明示的な設定ファイルのAUTH_URLへ読み取り専用でトップ/予約/ログイン画面、非会員の予約情報拒否、保護された監視APIを確認する。予約・メール・スタッフ作成は実行しない。認証後の全フローはブラウザで別途確認する。初期公開時には7.1.1/7.1.2、実メール、Cron、監視通知、バックアップ復元の結果も記録する。

結果：READMEと運用手順、実行用スクリプトを整備。デプロイ先未設定のため、外部smoke・実予約/管理フローは未実施。Task全体は未完了。

### 6.5 検証記録

| 対象 | 結果 |
| --- | --- |
| `npm run check` | 成功：Prisma validate/generate、lint、型チェック、単体41件 |
| 環境検査の単体テスト | staging/production、別DBロール、Preview、本番host混入、TLS不足、pooler誤り、秘密値/テストフラグと機密非出力を検証 |
| エラーログの単体テスト | 例外/URL/headersの機密値を記録しないことを検証 |
| `npm run test:e2e:http` | 成功：既存4系統。ops認証拒否・異常503・no-store・機密非露出・DBテーブル欠落時の固定503も確認 |
| `npm run test:recovery` | 成功：実dump/restoreと隔離処理、テストDB削除。既存DB保持 |
| `npm run build -- --webpack` | 成功：監視routeとinstrumentationを含む本番ビルド |
| hosted env:check / build:deploy / db:deployment / db:backup / smoke:deployment | 実際の外部設定なしのため未実施。検査ロジックとローカル復旧共通処理を検証 |
| CI | HTTP統合4系統を追加。GitHub上での実行は未確認 |

Task 7.2.2は完了、7.2.1/7.2.3/7.2.4はリポジトリ内準備まで。Story 7.2と本番リリースは未完了。

### 2026-10-01：ローカルバックアップと本番初期投入

- `db:backup:local`：既存の開発env読込みとCompose接続ガードを共有。publicをcustom formatで新規0600ファイルに保存し、失敗時は作成ファイルを削除。
- `db:import:production`：production設定・expected-host/database・確認フラグ・custom archiveを検査し、空のpublicだけに復元。既存オブジェクトを削除/上書きしない。アプリ/Cron/migrationを切り離した新DBへ実行する。
- pg_restoreは単一トランザクション。その後共有quarantine処理でセッション/トークン失効・未確定メール隔離。隔離失敗時は復元済みDBをオフラインに保ち、手動隔離または新DBで再実施する。
- 全量投入であり差分同期ではない。テストデータ・認証情報・移行履歴・権限・退会/取消の照合と切替は運用手順第4章に記載。本番実行・外部復旧確認は未実施のためTask 7.2.3の未完了状態を維持。
- 検証：型チェック・対象ESLint・CLI拒否テスト2件、ローカルbackup実行（0600/custom形式確認、検証dump削除）、使い捨てDBでのtest:recovery成功。本番投入スクリプトの実Neon接続は未確認。
- ローカルbackupのエラーを引数・接続設定・保存先なし・既存ファイル・権限・pg_dump段階で区別。backups作成を運用例に追加。実DBからbackups/local-20261001-check.dumpへの取得成功。
