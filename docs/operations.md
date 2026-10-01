# デプロイ・監視・バックアップ・復旧手順

対象：GitHub Actions（CI/CD）/ Vercel / Neon / Resend。2026-10-01更新。外部環境の確認記録は未登録。以下は設定と実施手順であり、本番実施済みの記録ではない。リリース責任者が接続先・変更内容・バックアップ・確認結果をリリース記録へ残す。

## 1. 環境の分離

| 環境 | アプリ | DB | メール |
| --- | --- | --- | --- |
| 開発 | localhost、既存.env/.env.local | Docker booking_sample | 模擬配信または専用テスト宛先 |
| 検証 | 専用Vercelプロジェクトと固定HTTPS URL | 専用Neonプロジェクト/ブランチ | テスト用受信アドレスのみ |
| 本番 | 本番Vercelプロジェクトと固定HTTPS URL | 本番専用Neonプロジェクト/ブランチ | 確認済み本番送信ドメイン |

検証DBを本番のコピーから作る場合は個人情報を持ち込まず、必要なら匿名化とメール隔離を先に行う。検証から本番へ同じ接続先や秘密値を使い回さない。未知のPRを本番秘密情報へ接続しない。今回のenv:checkは単一環境の整合性を確認するもので、複数環境間の分離を証明しない。責任者は各Neon endpointとVercelプロジェクトの対応表を別途照合する。

1. Neonで検証と本番のDBを別々に作成する。各環境のアプリ用・migration用のロールを分ける。
2. アプリの `DATABASE_URL` はpooler、`DIRECT_URL` は同一endpoint/databaseの直接接続にする。TLSを必須にする。`DEPLOYMENT_DB_HOST` に選んだ直接接続のhostnameを固定する。
3. 手元で確認する場合は `.env.hosted.example` を `.env.staging` と `.env.production` にコピーし、それぞれ別の秘密値を入力する。GitHub ActionsではEnvironment secretsからrunner上に一時設定ファイルを生成する（第2章）。既存の開発用.envは変更しない。
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

### 2.1 GitHub CI/CDの責務と実装状況

GitHub Actionsが検査・migration・Vercelへの公開を順番に実行する前提とする。リリース責任者は対象commitと変更内容を確認し、通常の本番migration実行はCDに一本化する。ビルド時・アプリ起動時・Preview生成時にはmigrationを適用しない。`build:deploy` は環境検証・Client生成・ビルドのみ。

**現在の `.github/workflows/ci.yml` はCIのみ。CD workflow、本番Environment、Vercel連携、バックアップ保管先はこの更新では実装・設定していない。** CIはpush・pull request・手動実行で起動し、checks（静的検査・隔離DB/HTTP検証・ビルド）とdependency-auditを実行する。`test:recovery` は現在のCIには含まれていないため、リリースの追加検証として実行する。以下はCD実装時に満たす運用要件。

| 段階 | 実行内容 | 次へ進む条件 |
| --- | --- | --- |
| CI | checks / dependency-audit / 復旧演習 | リリース対象SHAで全チェック成功 |
| 検証CD | 検証DBバックアップ → migration → 検証アプリ公開 → smoke / ブラウザ確認 | 同一SHA・SQLで検証成功、結果を記録 |
| 本番準備 | 本番設定・接続先照合、公開前ビルド、必要なリリース承認 | 本番Environmentの保護条件を満たす |
| 本番CD | バックアップの保管確認 → migration → 状態・権限確認 → 本番公開 → smoke | 各処理が成功。失敗した段階で後続を止める |

CDの設定要件：

1. デプロイ対象を保護されたリリースブランチ/タグに限定する。ブランチ名は運用で確定する。PRのCIに本番secretsを渡さない。CI・検証・本番のcheckoutとビルドは同じcommit SHAに固定し、途中でブランチ先頭を取り直さない。別workflowでCI完了を受ける場合も、その実行の成功・信頼できるブランチ・対象SHAを照合する。
2. GitHub Environmentsに `staging` / `production` を作り、各環境のsecretsと許可ブランチを分離する。必要な本番承認はRequired reviewersで設定する。利用可否はGitHubプランとリポジトリの公開範囲による。利用できなければ権限を制限した手動起動などで公開を制御する。
3. 本番CD全体（バックアップ〜公開後確認）を固定の `concurrency.group`（例：`booking-production-release`）で直列化し、`cancel-in-progress: false` を設定する。現在のCIの `cancel-in-progress: true` をCDへ引き継がない。すべての本番リリース入口で同じgroupを使い、手元からの並行migrationも禁止する。実行中のmigrationを手動cancelした場合は、再実行前に履歴と実スキーマを確認する。
4. VercelのGit連携によるpush時の自動デプロイを無効にし、GitHub Actionsからのみ公開する。例えば `vercel.json` の既存設定へ `"git": { "deploymentEnabled": false }` を追加する。**現在のvercel.jsonには未設定**。CDを有効にする前に設定し、既存のbuildCommand/cronsを保持する。
5. GitHubのEnvironment secretsにVercelの `VERCEL_TOKEN` と、環境別の `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`、DB・認証・メール・監視の設定を登録する。Vercel側にも実行時環境変数を登録する。GitHubへの登録だけではVercelアプリへ反映されない。migrationの `DIRECT_URL` はDDL用、`DATABASE_URL` はアプリ用ロールを使う。
6. DBコマンドはprocess.envだけではなく `--file` の内容を読む。runnerの一時ディレクトリへ `.env.hosted.example` と同じキーを持つ設定ファイルをsecretsから作成し、0600にする。dotenvとして引用・改行を正しく扱い、シェル文字列への直接展開、`set -x`、内容の出力を避ける。バックアップと設定ファイルを通常のActions artifact/cacheへ入れず、終了時（失敗時も）に一時ファイルを削除する。
7. Vercel CLIは検証した版を固定する。`vercel pull --environment=production` → `vercel build --prod` で公開前にビルドし、migrationと後述の確認成功後に `vercel deploy --prebuilt --prod` で公開する。認証とproject指定は環境ごとに行う。検証専用Vercelプロジェクトも固定URLを使うためProductionへ公開するが、`APP_ENV=staging` と検証DBを使用する。Preview用はpreviewの設定・検証DBを使い、本番DBに接続しない。
8. バックアップ用にサーバーに対応するpg_dump/pg_restoreをrunnerへ用意し、暗号化と35日保持の外部保管を実装する。暗号化済みアーカイブの保管完了と復元可能性を確認してからmigrationへ進む。run URL・SHA・migration名・保管ID・旧/新デプロイURL・確認結果をリリース記録へ残す。

順序の根拠：[VercelのGitHub Actions連携](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)、[Git自動デプロイの停止](https://vercel.com/docs/project-configuration/git-configuration)、[GitHubのEnvironment・concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。

### 2.2 本番migrationの実施手順

migrationは**GitへコミットしたSQLを本番DBへ適用する処理**。ローカルのデータを本番へ同期する処理ではない。通常の更新では第4章の全量importを使わず、既存本番データを保持して未適用SQLだけを適用する。

以下はCDに組み込む手順。CD実装前に担当者が実行する場合も、同じ対象SHAと順序を使い、本番自動公開と他のmigration実行を止める。コマンド例の `HOST` はNeon画面で照合した本番の直接接続hostname、`.env.production` は本番設定ファイルに置き換える。runnerでは一時ファイルの絶対パスを使う。パスワードをコマンド引数に入れない。

**1. リリース内容を準備・検証する**

- `prisma/schema.prisma` と `prisma/migrations/<migration名>/migration.sql` を同じcommitへ含める。適用済みSQLを後から編集しない。本番でmigrationを生成しない。
- SQLのDROP、TRUNCATE、型変更、NOT NULL、一意制約追加、既存行の更新、ロック時間をレビューする。旧アプリが動いたまま新スキーマを使えるか確認する。追加 → アプリ切替/必要なデータ補完 → 別リリースで削除・必須化の順を基本とする。
- `npm ci`、CI全チェック、`npm run test:recovery`、検証DBで同じSQLの適用、検証アプリの動作確認を成功させる。公開前に本番設定でVercelビルドを完了する。旧コードと互換性がない場合は、受付・管理操作・Cronなど書込み経路を止める変更窓を決め、再開条件を記録する。

**2. 接続先と現在の履歴を確認する**

Neonの本番プロジェクト/ブランチ・endpoint・database名・migrationロールを照合する。`APP_ENV=production`、pooler/directのDB一致、`DEPLOYMENT_DB_HOST=HOST` を確認する。スクリプトはstagingも受け付けるため、ファイル名だけで本番と判断しない。expected-hostのガードもdatabase名や環境を独立に証明するものではない。

```sh
npm run env:check -- --file .env.production
npm run db:deployment -- --file .env.production --expected-host HOST --action status
```

**statusの終了コードに注意**：Prisma 7は未適用migrationや初回の履歴テーブル未作成でも終了コード1を返す。現在のラッパーはCLI出力を抑制し、これらと接続障害/失敗履歴を同じ汎用エラーで返す。失敗を `|| true` や `continue-on-error` で無視してdeployへ進めない。CD実装時は事前状態を判別する検査を用意する。それまでは権限を持つ担当者が保護されたDBコンソール等で `_prisma_migrations` と対象SQLを照合し、「予定どおりの未適用だけ」または「初回の空DB」と確認した場合だけ進む。失敗履歴・履歴の分岐・接続不良なら停止する。[Prisma 7 statusの終了コード](https://www.prisma.io/docs/cli/v7/migrate/status)

初回以外の履歴確認例（DBコンソールで実行。`logs` は機密情報を含み得るため公開ログへ出さない）：

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM "public"."_prisma_migrations"
ORDER BY started_at;
```

`finished_at IS NULL AND rolled_back_at IS NULL` の履歴は原因調査が必要。初回に履歴テーブルがない場合は、publicに既存アプリテーブルがないことを確認する。既存テーブルがあるのに履歴がない場合は初期migrationを強行せず、別途baseline計画を作る。第4章の全量import済みDBでは移された履歴を確認し、未適用分だけを扱う。

**3. 直前バックアップを取得・保管する**

```sh
npm run db:backup -- --file .env.production --output /secure/location/release-new.dump
```

保存先は実在する書込み可能なディレクトリと新規ファイル名に置き換える。取得成功だけで進めず、暗号化・外部保管完了・取得時刻・対象DB・復元検証結果を記録する。バックアップ失敗/保管失敗は公開中止。稼働中の取得後にも予約等は更新されるため、復元時のデータ損失範囲を把握する。書込み停止が必要な変更では、停止後に最終バックアップを取得する。

**4. 未適用migrationを一度だけ適用する**

```sh
npm run db:deployment -- --file .env.production --expected-host HOST --action deploy
```

内部で `prisma migrate deploy --config prisma7.config.ts` を実行し、指定ファイルの `DIRECT_URL` へ接続する。未適用のmigrationを順に適用し、履歴へ記録する。Client生成・seed・ローカルデータ転送はしない。すでに適用済みならそのSQLを再適用しない。`db:migrate` はローカル専用なので本番で使わない。本番では `migrate dev` / `migrate reset` / `db push` / 開発用seedも使わない。

現在のラッパーはPrisma子プロセスのtimeoutが120秒。長時間DDLは検証時に実行時間とロックを測定し、必要な実行方法を別途準備する。timeoutや接続断でも「何も適用されなかった」と判断せず、履歴と実スキーマを確認してから復旧する。`migrate deploy` はスキーマの手動変更（drift）を網羅的に検出しないため、成功だけで制約・権限の正しさを保証しない。[Prisma 7 deployの仕様](https://www.prisma.io/docs/cli/v7/migrate/deploy)

**5. 状態・権限・初回設定を確認する**

```sh
npm run db:deployment -- --file .env.production --expected-host HOST --action status
# 初回だけ。既存管理者を上書きせず固定IDの管理者行を追加する。
npm run db:deployment -- --file .env.production --expected-host HOST --action bootstrap
```

適用後のstatusは終了コード0を必須とし、履歴・追加テーブル/列・CHECK/FK/一意制約を照合する。bootstrapはサンプル会員/予約/営業設定を作らず、管理者の認証情報は環境変数で設定する。

migrationロールはDDL権限を持ち、アプリロールには必要なpublicスキーマのUSAGEとSELECT/INSERT/UPDATE/DELETE、必要なsequence USAGE/SELECTだけを付与する。新規テーブルの権限もmigration後・公開前に確認する。アプリロールへDB作成・ロール管理権限を渡さない。復元時はACLを再適用する。

**6. 同じSHAのアプリを公開・確認する**

migrationと状態/権限確認成功後に、準備済みの同じSHAのVercelビルドを公開する。固定本番URLで `npm run smoke:deployment -- --file .env.production` と第5章の確認を行い、結果を記録する。受付・ワーカーを止めていた場合は、整合性・メール状態を確認してから再開する。CI/CD成功と実メール/Cron/ブラウザ確認を分けて記録する。

### 2.3 失敗時の対応

- CI/ビルド/バックアップ失敗：後続migration・公開を止め、旧アプリを継続使用する。
- migration失敗/timeout：公開を止め、`_prisma_migrations` と実スキーマ・部分適用されたSQLを照合する。migration全体が自動的にrollbackされたと仮定しない。失敗状態を無視して再実行しない。
- 失敗migrationの復旧：部分適用を安全に取り消したか、再適用可能な状態を検証した場合は `migrate resolve --rolled-back <migration名>` で再適用を許可する。残りのSQLを手動で完了させ、期待するスキーマ/データと一致した場合は `migrate resolve --applied <migration名>` で履歴を合わせる。**resolveはSQL実行・データ復元を行わず、履歴だけを更新する。** このリポジトリのラッパーはresolveを受け付けないため、接続先を照合した別の復旧作業として実施し、通常CDへ組み込まない。[Prisma 7の復旧手順](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/patching-and-hotfixing)
- migration成功後の公開失敗：追加migrationが旧コード互換なら旧アプリを継続使用し、DBを戻さず同じSHAの公開を再試行する。再実行時も履歴と現状を確認する。
- 新アプリで障害：旧コード互換ならVercelで旧デプロイへ戻す。アプリrollbackはDBを戻さない。
- 非互換・データ破損：受付・管理書込み・Cronを停止し、第4章の隔離復元・照合を行う。古いバックアップを稼働中DBへ上書きしない。

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

`/secure/location` は保存先の例であり、自動作成されない。実在する書込み可能なディレクトリを指定する。

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
# 保存先を作成。出力は存在しないファイルを指定する。
mkdir -p ./backups
npm run db:backup:local -- --output ./backups/local.dump
```

ローカルはNext.js開発時の優先順（process.env → .env.development.local → .env.local → .env.development → .env）で読み込む。DATABASE_URLとDIRECT_URLは同一のlocalhost/127.0.0.1:5432/booking_sample、publicスキーマのみ許可。`.env.production` は不要。ホスト側にpg_dump/pg_restoreが必要で、Docker内の実行へは自動切替しない。publicの構造・データ・Prisma migration履歴をcustom format/0600で保存し、既存ファイルを上書きしない。

本番への投入は**空の新しいNeon DB/ブランチへの全量復元**。データの差分同期・マージではない。既存publicオブジェクトがあれば拒否し、--cleanや既存DB削除は実行しない。すでに運用中の本番には、旧DBを保持して新ブランチへ復元・検証後、接続を切り替える。現在の本番の退会・取消・新規予約はローカルdumpに含まれないため、置換を通常の更新手段にしない。

1. ローカルのテスト会員・予約・スタッフ・seed設定をレビューし、本番へ移すデータを確定する。dumpは信頼できる自分のバックアップだけを使う（復元にはSQL実行が含まれる）。
2. アプリ・Cron・migrationから切り離した空の本番Neon DB/ブランチを準備する。既存本番があればdb:backupで別途保全する。
3. `.env.hosted.example` を元に復元先の `.env.production` を設定。全deployment設定検査に加えAPP_ENV=productionを要求する。HOSTとDATABASEはNeon画面で直接接続先と照合する。
4. 以下を実行する。環境ファイル名は任意だが、接続先の明示と確認フラグは必須。

```sh
npm run db:import:production -- --file .env.production --input ./backups/local.dump --expected-host HOST --expected-database DATABASE --confirm-empty-production-import
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
