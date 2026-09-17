# 詳細設計：Epic 2 開発環境とデータ基盤

更新日：2026-09-17

状態：Task 2.1.1確認完了。Task 2.1.2以降は未完了。

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

## 3. Task 2.1.2：次のハンズオン設計

次の到達点は「ローカルPostgreSQLへアプリ側の接続処理から疎通できる」こと。まだ実施していない手順を以下に整理する。

1. 既存環境変数の値を出力せず、接続先がローカルComposeと一致するか確認する。外部DBを向いている場合は流用せず、ローカル用の設定を分離する。
2. `.env.example`を作り、ローカル専用の`DATABASE_URL`・`DIRECT_URL`を記載する。既存`.env`をコピー操作で上書きしない。`.gitignore`でサンプルだけを追跡対象にする。
3. `docker compose ps -a`等で既存の停止コンテナ・永続ボリュームも確認してから、`docker compose up -d --wait db`で起動する。ポート競合があれば既存サービスを勝手に停止しない。
4. Next.js側では`DATABASE_URL`、CLIでは`DIRECT_URL`を使う責務を明記する。dotenvとNext.jsの環境変数読込順序も確認する。
5. Prismaのpgアダプターを使うサーバー専用接続処理を設計・作成し、接続を共有する。Client生成とモデル未定義時の動作は実際の版で確認する。
6. データを変更しない疎通で接続を検証し、資格情報を含まない成功／失敗結果を記録する。業務モデルのmigrationはStory 2.2で行う。

コンテナ停止は`docker compose down`でデータを保持する。`down -v`やDB resetを通常のセットアップ手順に含めない。

## 4. 後続Taskと完了条件

| Task | 状態 | 完了に必要な成果物・検証 |
| --- | --- | --- |
| 2.1.1 | 確認完了 | 設定・実行版・依存版と現状の静的検証を第2章へ記録 |
| 2.1.2 | 未着手（手順案あり） | 環境変数サンプル、DB起動、サーバー接続処理、実接続確認 |
| 2.1.3 | 未着手 | lint・型生成／型チェック・テスト・buildの手順、CI、実行結果 |
| 2.1.4 | 未着手 | README第2・10章からセットアップを再現できること |
| Story 2.2 | 未着手 | 採用設計に沿うモデル・制約・migration・seed、DB統合検証 |

## 5. 変更・検証記録

| 日付 | 内容 | 結果 |
| --- | --- | --- |
| 2026-09-17 | Epic 2専用設計書を作成。Task 2.1.1の設定・バージョン・静的検証 | lint・型チェック・schema検証成功。実行中Composeコンテナなし。DB接続・起動・buildは未実施 |
