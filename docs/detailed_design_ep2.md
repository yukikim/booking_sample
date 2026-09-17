# 詳細設計：Epic 2 開発環境とデータ基盤

更新日：2026-09-17

状態：Task 2.1.1・2.1.2完了。Task 2.1.3以降は未完了。

## 1. 文書の範囲

[README](../README.md)のEpic 2を対象とし、設計・実装結果・検証結果を進捗に合わせて追記する。Epic 1の業務・認証・状態遷移の設計は[詳細設計](detailed_design.md)を参照する。Task 1.2.4は利用者がチェック済みであることを確認した。

依存追加・設定変更・DB変更と、調査・検証だけの作業を区別する。Task 2.1.1の完了はアプリ起動・DB接続・ビルド・CIの完了を意味しない。

## 2. Task 2.1.1：既存設定・採用バージョンの確認

### 2.1 実行環境と依存関係

2026-09-17に実機で確認。Node.jsはv22.23.1、npmは10.9.8、Docker Composeはv2.40.3-desktop.1。

| パッケージ | package.jsonの指定 | lockfile・インストール済みの版 |
| --- | --- | --- |
| Next.js | 16.3.5 | 16.3.5 |
| React / React DOM | 19.2.8 | 19.2.8 |
| TypeScript | ^5 | 5.9.3 |
| Tailwind CSS / PostCSSプラグイン | ^4 | 4.3.3 |
| Prisma CLI / Client / pgアダプター | ^7.10.0 | 7.10.0 |
| pg | ^8.23.0 | 8.23.0 |
| ESLint | ^9 | 9.39.5 |

表の各パッケージはpackage-lock.jsonとnode_modulesの版が一致した。更新・再インストールは行っていない。

インストール済みパッケージのenginesはNext.jsがNode.js >=20.9.0、Prismaが ^20.19 / ^22.12 / >=24.0。実行中の22.23.1は両方を満たす。開発・CIのNode版固定はTask 2.1.3で整える。

### 2.2 構成と責務

| ファイル・場所 | 確認内容 |
| --- | --- |
| `src/app/` | App Routerの初期画面・レイアウト・CSS。予約UIは未実装 |
| `next.config.ts` | 初期設定。独自オプションなし |
| `tsconfig.json` | strict有効、noEmit、Next.jsプラグイン、`@/*`→`src/*` |
| `postcss.config.mjs` | `@tailwindcss/postcss`を使用 |
| `src/app/globals.css` | Tailwind importとテーマ変数を定義 |
| `eslint.config.mjs` | Next.js Core Web VitalsとTypeScript設定 |
| `prisma7.config.ts` | dotenv読込、`DIRECT_URL`参照、schema・migrationsのパスを指定 |
| `prisma/schema.prisma` | PostgreSQL、prisma-client generator。業務モデルなし |
| `src/generated/prisma/` | 現在の生成先。業務モデルがないため、生成物の存在だけで予約DBの準備完了としない |
| `docker-compose.yml` | PostgreSQL 17 Alpine、127.0.0.1:5432、名前付き永続ボリューム、ヘルスチェック |
| `.env` | ファイル存在を確認。値は本書・出力へ転記しない |
| `.env.local` / `.env.example` | 現在は存在しない |

Prisma設定名は一般的な`prisma.config.ts`とは異なるが、**今回の環境では`prisma validate`だけで`prisma7.config.ts`を読み込んだ**。明示的な`--config prisma7.config.ts`でも検証成功。名前だけを根拠に不具合とせず、今回は改名しない。再現手順では設定ファイルを明示する。

### 2.3 実行した確認と結果

リポジトリルートで実行した。Prisma検証はスキーマの静的検証であり、DBへの疎通確認ではない。

| コマンド | 結果 | 確認できないもの |
| --- | --- | --- |
| `node --version` / `npm --version` | 22.23.1 / 10.9.8 | CI・本番の実行版 |
| `npm run lint` | 終了コード0 | 画面の表示・業務動作 |
| `./node_modules/.bin/tsc --noEmit --incremental false` | 終了コード0 | 新規checkoutでのNext.js型生成を含む再現性 |
| `./node_modules/.bin/prisma validate` | config読込・schema valid、終了コード0 | DB接続・テーブル存在 |
| `./node_modules/.bin/prisma validate --config prisma7.config.ts` | 同上、終了コード0 | マイグレーション適用 |
| `docker compose version` | CLI利用可能 | コンテナ・DB起動 |
| `docker compose ps` | 終了コード0、実行中コンテナの行なし | 停止コンテナ・ボリュームの有無、DB接続 |

Docker状態確認は最初にsandboxのソケットアクセス制限で失敗したが、読み取り専用の権限拡張で再実行し成功した。Docker停止と誤認しない。パッケージの版確認は一部のexports制限に対応し、package.jsonをファイルとして読み直して確認した。

Next.js同梱ガイド`node_modules/next/dist/docs/01-app/01-getting-started/01-installation.md`とPrisma CLIスキルのvalidateリファレンスを参照した。Next.js 16のbuildはlintを実行しないため、今後も別の確認手順として管理する。

### 2.4 今回未実施の確認

- 開発サーバーの起動・HTTP応答・ブラウザ表示。
- PostgreSQLの起動、接続先のローカル性確認、SQL疎通。
- 本番ビルド。現在のレイアウトはGoogle Fontsを使用しており、ビルド時の取得を含め実行確認が必要。
- 新規環境での`npm ci`と再現確認。
- Prismaモデル追加・Client再生成・マイグレーション・初期データ。
- 自動テスト基盤・CI。

## 3. Task 2.1.2：ローカルDBとPrisma接続（実装・疎通確認済み）

### 3.1 接続構成

Next.jsのNode.jsサーバー → `getPrisma()` → `PrismaPg` → ローカルPostgreSQL。アプリは`DATABASE_URL`、Prisma CLIは`DIRECT_URL`を参照する。今回、両変数が既存Composeのローカルhost・port・DB名・資格情報に一致することを、値を出力せず確認した。既存`.env`は変更していない。

作業開始時、前回とは異なり`booking_sample-db-1`が既にhealthyだった。既存の`booking_sample_postgres_data`を維持し、`db:up`による再現手順でもhealthyを確認した。新規DB・テーブルの作成やmigrationは行っていない。

### 3.2 追加・変更ファイル

| ファイル | 責務 |
| --- | --- |
| `.env.example` | Compose専用の開発用接続例。公開可能なローカル専用資格情報のみ |
| `.gitignore` | `.env*`を引き続き無視し、`.env.example`のみ例外化 |
| `src/lib/prisma.ts` | server-onlyな遅延生成関数`getPrisma()`。pgアダプターとClientを共有 |
| `scripts/check-db.ts` | Next.jsと同じ環境読込後、ローカル接続先を検証し`SELECT 1`を実行 |
| `package.json` / `package-lock.json` | 実行スクリプトと必要依存を追加 |

追加依存は`server-only` 0.0.1、`@next/env` 16.3.5、開発依存`tsx` 4.23.13。正確な版を指定した。Prisma・Next.js等の既存指定は変更していない。

### 3.3 Clientのライフサイクル

- `server-only`でClient Componentからのimportを禁止する。
- 初回の`getPrisma()`呼出しで`DATABASE_URL`を確認しClientを作る。モジュールを読むだけでは接続を作らない。
- 開発時はglobalThisに保持し、ホットリロードでプールが増え続けることを避ける。本番はモジュール内で共有する。
- pgプール上限はプロセスあたり5、接続・クエリのタイムアウトは5秒を初期値とする。サービス全体の上限ではなく、本番の同時インスタンス数を含む調整はデプロイ時に行う。
- SQL・パラメータ・接続情報を自動ログ出力しない。疎通コマンドは例外原文を表示せず、固定のエラーメッセージで終了する。
- Web要求ごとには切断しない。疎通CLIだけは終了前に`$disconnect()`する。

### 3.4 環境変数の読込

Next.jsはprocess.env、環境別local、`.env.local`、環境別ファイル、`.env`の順で既存値を優先する。`db:check`は`@next/env`で開発時と同じ読込を行う（NODE_ENV=testではNext.jsのtest規則が適用される）。`DATABASE_URL`に`NEXT_PUBLIC_`を付けない。

Prisma CLIは現在の`prisma7.config.ts`内のdotenvにより`.env`を読む。既にexport済みの環境変数を優先し、`.env.local`は自動では読まない。このため`.env.local`を追加した場合、アプリとCLIが別DBへ向く可能性があり、両変数の接続先を意識して管理する。

`db:check`は接続前にlocalhost系・5432番・booking_sampleというDB名を検証し、クエリパラメータは`schema=public`以外を拒否する。外部DBやパラメータによる接続先上書きを疎通コマンドに流用しない。この制約はローカル用コマンドだけに適用し、アプリの本番接続をlocalhostへ固定するものではない。

### 3.5 ハンズオン手順

リポジトリルートで実行する。依存インストール済みの今回の環境では1〜2は不要。

1. 新規取得時は`npm ci`でlockfileに従って依存を入れる（クリーン環境の再現確認はTask 2.1.3）。
2. `.env`が存在しない場合だけ`.env.example`を`.env`へコピーする。存在する場合は上書きせず接続先を確認する。
3. 次を順に実行する。

```bash
npm run db:up
npm run db:generate
npm run db:validate
npm run db:check
```

期待する最終表示：`Local PostgreSQL: SELECT 1 succeeded (shared Prisma Client).`

`db:generate`・`db:validate`は`--config prisma7.config.ts`を明示する。モデル未定義でも今回のPrisma 7.10.0ではClient生成とraw queryが成功した。確認用の仮モデルは追加しない。

`db:check`の内部コマンドは`node --conditions=react-server --import tsx scripts/check-db.ts`。CLIでもサーバー用条件で`server-only`モジュールを読み、実際のアプリ用接続関数を使って検証する。公開のDB確認APIは追加しない。

停止する場合は`npm run db:down`。名前付きボリュームを削除しないためデータは保持される。今回、既に稼働していたDBは停止せず継続稼働させている。`down -v`やresetは通常手順に含めない。

### 3.6 検証結果・残課題

| 確認 | 結果 |
| --- | --- |
| `npm run db:up` | 既存サービスhealthy |
| `npm run db:generate` | Prisma 7.10.0 Client生成成功。生成物に差分なし |
| `npm run db:validate` | schema valid |
| `npm run db:check` | 同一Client共有とSELECT 1成功。データ更新なし |
| 外部hostへDATABASE_URLを一時上書きしたCLI実行 | 接続前に終了コード1。URL・資格情報は出力されない |
| react-server条件なしで接続モジュールをimport | server-onlyの境界エラーで拒否 |
| `npm run lint` / `tsc --noEmit --incremental false` | 両方終了コード0 |
| `git diff --check` | 成功 |

依存追加時のnpm auditでhigh 4件を検出。内訳はPrisma CLIおよび推移依存`@prisma/config`・`deepmerge-ts`・`mysql2`。今回の接続成功と脆弱性解消は別であり、自動の破壊的更新は行っていない。Task 2.1.3で修正版・影響範囲を確認する課題として残す。

DB統合での予約整合性、アプリHTTP経由の接続、ブラウザ、ビルド、CI、クリーンインストールは未確認。今回の実接続結果はローカル環境の疎通だけを示す。

## 4. 後続Taskと完了条件

| Task | 状態 | 完了に必要な成果物・検証 |
| --- | --- | --- |
| 2.1.1 | 確認完了 | 設定・実行版・依存版と現状の静的検証を第2章へ記録 |
| 2.1.2 | 完了 | 第3章に実装と実接続結果を記録 |
| 2.1.3 | 未着手 | lint・型生成／型チェック・テスト・buildの手順、CI、実行結果 |
| 2.1.4 | 未着手 | README第2・10章からセットアップを再現できること |
| Story 2.2 | 未着手 | 採用設計に沿うモデル・制約・migration・seed、DB統合検証 |

## 5. 変更・検証記録

| 日付 | 内容 | 結果 |
| --- | --- | --- |
| 2026-09-17 | Epic 2専用設計書を作成。Task 2.1.1の設定・バージョン・静的検証 | lint・型チェック・schema検証成功。実行中Composeコンテナなし。DB接続・起動・buildは未実施 |
| 2026-09-17 | Task 2.1.2実装 | サンプル・接続処理・CLI追加。既存DBのhealthy、SELECT 1、拒否系、lint・型チェックを確認。audit high 4件は後続課題 |
