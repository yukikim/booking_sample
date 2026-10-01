# デプロイ・監視・バックアップ・復旧手順

対象：Vercel / Neon / Resend。2026-09-30時点で外部環境は未作成。以下は設定と実施手順であり、本番実施済みの記録ではない。リリース責任者が接続先・変更内容・バックアップ・確認結果をリリース記録へ残す。

## 1. 環境の分離

| 環境 | アプリ | DB | メール |
| --- | --- | --- | --- |
| 開発 | localhost、既存.env/.env.local | Docker booking_sample | 模擬配信または専用テスト宛先 |
| 検証 | 専用Vercelプロジェクトと固定HTTPS URL | 専用Neonプロジェクト/ブランチ | テスト用受信アドレスのみ |
| 本番 | 本番Vercelプロジェクトと固定HTTPS URL | 本番専用Neonプロジェクト/ブランチ | 確認済み本番送信ドメイン |

検証DBを本番のコピーから作る場合は個人情報を持ち込まず、必要なら匿名化とメール隔離を先に行う。検証から本番へ同じ接続先や秘密値を使い回さない。未知のPRを本番秘密情報へ接続しない。今回のenv:checkは単一環境の整合性を確認するもので、複数環境間の分離を証明しない。責任者は各Neon endpointとVercelプロジェクトの対応表を別途照合する。

1. Neonで検証と本番のDBを別々に作成する。各環境のアプリ用・migration用のロールを分ける。
2. アプリの `DATABASE_URL` はpooler、`DIRECT_URL` は同一endpoint/databaseの直接接続にする。TLSを必須にする。`DEPLOYMENT_DB_HOST` に選んだ直接接続のhostnameを固定する。
3. `.env.hosted.example` を `.env.staging` と `.env.production` にコピーし、それぞれ別の秘密値を入力する。既存の開発用.envは変更しない。
4. 検証は `APP_ENV=staging`、本番は `APP_ENV=production`。`AUTH_URL` は実際に開く固定HTTPS origin。管理者パスワードは15〜128文字。秘密情報をGit・チャット・チケットへ貼らない。
5. AUTH_SECRET・AUTH_RATE_LIMIT_SECRET・CRON_SECRET・OPS_SECRETは各々32文字以上の独立したランダム値。MAIL_PAYLOAD_KEYは独立した32バイトのBase64値。鍵の生成例：`openssl rand -hex 32` / `openssl rand -base64 32`。値は秘密管理へ保存する。
6. VercelにNext.jsプロジェクトとして登録し、Nodeはpackage.jsonのenginesと整合する22系、Build Commandはvercel.jsonの `npm run build:deploy` を使用する。Production/Previewの環境変数を区別し、Previewは検証DBだけへ接続する。固定検証URLを使うため、検証専用プロジェクトのProduction環境はAPP_ENV=stagingとしてよい。本番プロジェクトのPreviewもstagingにする。
7. `AUTH_TEST_TSCONFIG`・`MAIL_TEST_DISABLE_IMMEDIATE` は外部環境へ登録しない。環境変数変更後は再デプロイする。
8. 以下のオフラインチェックを実行する。成功後も実接続と環境分離の照合は別途必要。

```sh
npm run env:check -- --file .env.staging
npm run env:check -- --file .env.production
```

Resendは送信可能な確認済みドメインをRESEND_FROMへ設定する。検証では専用の受信先を使う。初期カタログは管理画面で実際のメニュー・部屋・施術者・営業時間・休憩を設定する。本番に開発用seedを実行しない。

## 2. リリースとmigration

migrationはビルド時・アプリ起動時・Preview生成時には適用しない。`build:deploy` は環境検証・Client生成・ビルドのみ。migration実行者を1人に決め、同時実行せず、同一コミットのSQLを検証→本番の順で適用する。

1. `npm run check`、`npm run test:db`、`npm run test:e2e:http`、`npm run test:recovery`、本番ビルドを成功させる。7.1.1/7.1.2の未完了項目も初期公開までに完了する。
2. migration SQLをレビューする。既存コードと互換性を保つ追加を先に適用し、削除/必須化等は別リリースに分ける。予約への影響と長時間ロックを確認する。
3. 検証DBでバックアップ取得、migration適用、動作確認を行う。
4. 本番DBの接続先・バックアップの取得時刻・対象コミット・旧デプロイURLを記録する。書込みと互換性を保てない変更は受付を止め、変更窓を設ける。
5. 本番migrationを適用してから、そのスキーマと互換性のあるアプリを公開する。自動公開がmigrationより先に走らないよう、Vercelの公開操作をリリース責任者が管理する。
6. 初回のみ、固定IDの管理者行をbootstrapする。これは既存管理者を上書きせず、サンプル予約・会員・営業設定を追加しない。

```sh
# HOSTにはNeon画面で照合した直接接続hostnameを入力する。パスワードは引数に入れない。
npm run db:deployment -- --file .env.staging --expected-host HOST --action status
npm run db:deployment -- --file .env.staging --expected-host HOST --action deploy
npm run db:deployment -- --file .env.staging --expected-host HOST --action bootstrap
# 本番は.env.productionと本番HOSTを照合して同じ順で実施する。
```

migration用ロールはDDL権限を持ち、アプリ用ロールは必要なpublicスキーマのUSAGEとSELECT/INSERT/UPDATE/DELETE、必要なsequence USAGE/SELECTだけを付与する。migration後に新規テーブルの権限も付与する。アプリ用ロールへDB作成・ロール管理権限を渡さない。復元時はACLを再適用する。

失敗時：

- ビルド失敗：旧アプリを継続使用し、再公開しない。
- migration失敗：公開を止め、`_prisma_migrations`と実スキーマを照合する。SQLを修正・検証し、必要な場合だけPrisma migrate resolveで状態を整える。成功扱いへ変更して再実行を強行しない。
- 新アプリで障害：追加migrationが旧コード互換ならVercelで旧デプロイへ戻す。アプリのrollbackはDBを戻さない。
- 非互換・データ破損：受付とCronを停止し、下記の隔離復元・照合を行う。古いバックアップを稼働中DBへ上書きしない。

## 3. 監視とメール復旧

`GET /api/ops/health` に `Authorization: Bearer OPS_SECRET` を付ける。認証なしは401。正常は200、メール異常またはDB障害は503。Cache-Controlはno-store。応答は件数と遅延秒だけで、宛先・会員ID・本文・トークンは含まない。

外部監視サービスを設定後、1分間隔で確認する。DB障害、5分以上の期限到来メール滞留、直近24時間のFAILED、UNKNOWN、期限超過SENDINGを検知する。FAILEDは24時間、UNKNOWNは照合・対応まで継続して要注意になる。監視はメール送信やDB変更をしない。503を検知したら運用担当へ通知する設定を監視サービス側で行う。今回は通知先・外部監視サービスは未設定。

`src/instrumentation.ts` はサーバー捕捉エラーを `SERVER_REQUEST_ERROR` とroute種別のみで記録する。API側が捕捉して返す503はHTTPステータスと監視APIで確認する。VercelのLogsでデプロイ、時刻、ステータスを絞り込む。独自ログは例外本文・リクエストURL・Cookie・Authorizationを出さない。フレームワーク/基盤の自動ログは別経路なので、外部ログ保存先のフィルタと実ログを検証する。技術ログ90日保持には保存先/Drains等の契約・設定が必要で、Vercel標準の保持期間だけでは保証しない。監査ログと技術ログを混同しない。

会員手続きのメールはDB commit後のユーザー操作直後にdispatchし、Cronは回復・再試行用。vercel.jsonは毎分 `/api/cron/mail` を実行する構成。毎分実行可能なプランを用意する（Hobbyは日次制限）。Vercel CronはProductionデプロイだけに適用されるため、Previewは手動/別schedulerで確認する。検証専用プロジェクトのProductionでもテストメールのみに限定する。

障害時の処理：

- PENDING/RETRY_WAIT：次回時刻・リンク期限・会員/予約状態を確認する。Cronまたは保護されたワーカー入口で再処理する。開発用 `mail:send` は既存.envを読むため、外部環境の回復にそのまま使わない。
- 一時エラー：1/5/30分後、最大3回再試行（初回を含め4回）。期限内だけ再試行する。
- 恒久エラー/期限切れ：停止。送信ドメイン・宛先・設定を確認し、利用者の正規の再送操作で新しい要求を作る。
- UNKNOWN/リース切れ：結果不明。Resendの配信結果と操作履歴を照合し、自動でPENDINGへ戻さない。
- ACCEPTED：プロバイダー受付済みを意味し、受信箱への到着保証ではない。必要ならprovider側でバウンス等も確認する。
- 店舗都合案内：再送は管理画面の権限付き操作を使い、候補・予約版・確認状態を再検証する。メール配信状態と顧客対応状態は別に扱う。

## 4. バックアップと復元

方針：毎日と本番migration直前に直接接続で取得し、取得から35日保持。暗号化してリポジトリ外の保管先へ保存し、アクセス制限・取得結果の監視・保持期限を設定する。Neonの履歴復元は契約の保持期間を確認し、35日を満たす外部アーカイブを用意する。日次取得により復旧時点は最大約24時間前になり得るため、受付継続時のデータ損失許容と復旧時間は初回公開前に責任者が確認する。現時点では外部保管・日次scheduler・保存期限処理は未設定。

```sh
# PostgreSQLのpg_dump/pg_restoreを用意する。pg_dumpはサーバー以上の対応版を使う。
# 出力は新規ファイルだけ。上書きしない。DIRECT_URLは.env.productionから読む。
npm run db:backup -- --file .env.production --output /secure/location/new-backup.dump
```

生成ファイルは0600。認証情報はCLI引数へ渡さない。アーカイブ自体には個人情報が入るので、取得直後に暗号化・保管し、平文ファイルを管理する。ツール出力をチャットへ貼らない。

復元手順：

1. 書込みとメールワーカーを止める。障害前後の監査・退会・権限変更・新規予約・Resend結果を別途保全する。
2. 新しい隔離DB/Neonブランチを作成する。アプリ・Cron・外部メールへ接続しない。取得時刻、失われ得る予約・操作の範囲を記録する。
3. 秘密管理でPGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODEを設定し、復元先を照合する。`pg_restore --dbname "$PGDATABASE" --no-owner --no-acl --exit-on-error --single-transaction /secure/location/backup.dump` を実行する。既存稼働DBへの--cleanや上書きを使わない。
4. 下のトランザクションで全セッション・確認リンクを失効させ、復元された未確定配信をUNKNOWNへ隔離する。これは予約/会員/権限を変更しない。スタッフ・管理者のセッションも対象。
5. migration履歴・CHECK/FK/一意制約・予約と枠・退会状態・権限を照合する。バックアップ後の操作は自動復元できないため、保全記録との突合を責任者が行い、退会者の復活や取消済み予約の再受付を防ぐ。
6. 権限を再付与し、認証/暗号化鍵を回転する。認証Versionと管理者Versionを照合する。旧リンク・旧Cookieで入れないことを確認する。
7. 修復済みDBへ新デプロイの接続を向け、メールを止めた状態で検証する。UNKNOWNを自動再送しない。予約整合・本人確認・配信履歴を確認してから受付とワーカーを再開する。

```sql
BEGIN;
UPDATE "AppSession" SET "revokedAt"=clock_timestamp() WHERE "revokedAt" IS NULL;
UPDATE "AuthToken" SET "revokedAt"=clock_timestamp() WHERE "revokedAt" IS NULL;
UPDATE "EmailDelivery" SET status='UNKNOWN', "closedAt"=clock_timestamp(),
  "nextAttemptAt"=NULL, "leaseId"=NULL, "leaseExpiresAt"=NULL,
  "encryptedPayload"=NULL, "payloadKeyId"=NULL, "payloadExpiresAt"=NULL
WHERE status IN ('PENDING','RETRY_WAIT','SENDING');
UPDATE "EmailDeliveryAttempt" SET result='UNKNOWN', "finishedAt"=clock_timestamp(),
  "errorCode"='RESTORED_DATABASE' WHERE result='STARTED';
COMMIT;
```

`npm run test:recovery` はローカルCompose接続ガードを通し、使い捨てDBを2つ作って実際のdump/restoreと隔離処理を検証し、テストDBとアーカイブを削除する。既存booking_sampleをリセットしない。定期的に、外部保管したバックアップについても同じ復元・照合を行う。

### ローカルDBのバックアップと本番への初期投入（2026-10-01追加）

```sh
npm run db:up
# 親ディレクトリは先に作成。出力は存在しないファイルを指定する。
npm run db:backup:local -- --output /secure/location/local.dump
```

ローカルはNext.js開発時の優先順（process.env → .env.development.local → .env.local → .env.development → .env）で読み込む。DATABASE_URLとDIRECT_URLは同一のlocalhost/127.0.0.1:5432/booking_sample、publicスキーマのみ許可。`.env.production` は不要。ホスト側にpg_dump/pg_restoreが必要で、Docker内の実行へは自動切替しない。publicの構造・データ・Prisma migration履歴をcustom format/0600で保存し、既存ファイルを上書きしない。

本番への投入は**空の新しいNeon DB/ブランチへの全量復元**。データの差分同期・マージではない。既存publicオブジェクトがあれば拒否し、--cleanや既存DB削除は実行しない。すでに運用中の本番には、旧DBを保持して新ブランチへ復元・検証後、接続を切り替える。現在の本番の退会・取消・新規予約はローカルdumpに含まれないため、置換を通常の更新手段にしない。

1. ローカルのテスト会員・予約・スタッフ・seed設定をレビューし、本番へ移すデータを確定する。dumpは信頼できる自分のバックアップだけを使う（復元にはSQL実行が含まれる）。
2. アプリ・Cron・migrationから切り離した空の本番Neon DB/ブランチを準備する。既存本番があればdb:backupで別途保全する。
3. `.env.hosted.example` を元に復元先の `.env.production` を設定。全deployment設定検査に加えAPP_ENV=productionを要求する。HOSTとDATABASEはNeon画面で直接接続先と照合する。
4. 以下を実行する。環境ファイル名は任意だが、接続先の明示と確認フラグは必須。

```sh
npm run db:import:production -- --file .env.production --input /secure/location/local.dump --expected-host HOST --expected-database DATABASE --confirm-empty-production-import
```

5. 復元は単一トランザクションで行い、その後別トランザクションで全AppSession/AuthTokenを失効、未確定EmailDelivery/AttemptをUNKNOWNへ隔離する。復元後の隔離に失敗した場合、復元データは残る。失敗時は接続を切り替えず、隔離SQLを実行・検証するか新しい空DBでやり直す。自動削除・自動再試行は行わない。
6. 同一コード版のmigration履歴・制約・会員/予約/退会/権限・営業時間を照合し、必要なmigrationを明示適用する。旧ロールのACLは復元しないのでアプリロールの権限を再付与する。ローカルのスタッフ/会員パスワードハッシュも移るため、本番用認証情報を確認・変更し、管理者Versionと環境側の認証/メール暗号化鍵も確認する。UNKNOWNメールを自動再送しない。
7. メールを停止したまま新DBで検証してから本番アプリの接続先を切り替え、公開後確認を実施して受付/ワーカーを再開する。

本番スクリプト自体は本番DBへ接続するため、ローカルの検証演習では実行しない。`test:recovery` は使い捨てDBで共有dump/restore・隔離処理を検証する。本番への実投入は別途実施・記録する。

## 5. デプロイ後の確認と公開判定

```sh
npm run smoke:deployment -- --file .env.staging
# 検証後、本番公開先でも.env.productionを指定して実施
```

これはトップ・予約・ログイン3種のHTML、非会員予約情報の拒否、認証付き監視APIを確認する読み取り専用チェック。メール・予約・スタッフ作成は実行しない。Deployment Protectionで401/リダイレクトになる場合は、正規のアクセス方法で確認して保護を維持する。

続いて、検証用会員・受信アドレスで以下をブラウザから確認し、実施者・日時・commit・URL・結果を記録する。本番では責任者が許可した専用の検証予約/時間帯だけを使い、実顧客の予約を操作しない。

- 非会員検索、入会、確認メール受信、確認、ログイン、予約、変更、取消、ログアウト。
- 再設定・退会・復旧。旧セッション/リンクの拒否。
- 管理者/スタッフログイン、スタッフ作成と最小権限、代理予約、強制退会、権限不足の拒否。
- 設定変更による要調整、確認後の案内、受信、店舗対応による解決。
- Cronの成功と一時失敗後の回復、監視の異常通知・復旧通知、実ログの機密情報非露出。
- スマートフォン/PC表示・キーボード操作。7.1.1/7.1.2の未完了項目を完了する。

外部接続・実メール・Cron・バックアップ保管・監視通知が未確認の間はStory 7.2や初期リリース完了にしない。

## 6. 根拠資料

- [Vercel環境分離](https://vercel.com/docs/deployments/environments)、[環境変数](https://vercel.com/docs/environment-variables)
- [Vercel Cronのプラン条件](https://vercel.com/docs/cron-jobs/usage-and-pricing)、[Cron管理](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime)、[Instant Rollback](https://vercel.com/docs/instant-rollback)
- [PrismaのNeon接続](https://docs.prisma.io/docs/orm/v6/overview/databases/neon)（接続先のpooler/direct区分を参照。Prisma 7設定はリポジトリのconfig/adapterを使用）
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
