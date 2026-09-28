# 詳細設計：Epic 2 開発環境とデータ基盤

更新日：2026-09-28

状態：Task 2.1.1〜2.1.4・2.2.1〜2.2.5完了。第13章に運用モデル・曜日設定の保存先と追加migrationの検証結果を記録。次はTask 2.2.6。認証・予約・配信等の業務サービスと画面は未実装、今回変更後のGitHub CI実行は未確認。

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
| 2.1.3 | 手順・CI設定整備完了 | 第6章にローカル再現結果を記録。修正後のGitHub実行は未確認。監査解消は第7章 |
| 2.1.4 | 完了 | README第2・10章へ手順を統合。隔離コピーでDB疎通・静的チェック・dev／startのHTTP応答・buildを確認（第8章） |
| 2.2.1 | 完了 | 基本10モデル・3enum、Client生成、静的チェック・SQL出力確認（第9章）。DB未適用 |
| Story 2.2 | 進行中 | 2.2.2〜2.2.6のスナップショット・占有枠・制約・migration・seed・運用／設定モデルとDB統合検証が残る |

## 5. 変更・検証記録

| 日付 | 内容 | 結果 |
| --- | --- | --- |
| 2026-09-17 | Epic 2専用設計書を作成。Task 2.1.1の設定・バージョン・静的検証 | lint・型チェック・schema検証成功。実行中Composeコンテナなし。DB接続・起動・buildは未実施 |
| 2026-09-17 | Task 2.1.2実装 | サンプル・接続処理・CLI追加。既存DBのhealthy、SELECT 1、拒否系、lint・型チェックを確認。audit high 4件は後続課題 |
| 2026-09-19 | Task 2.1.4：README第2・10章更新、第8章に設計・再現結果を記録 | npm ci・check（14件）・DB疎通・build・dev／startのHTTP 200成功、監査0件。ブラウザ目視・GitHub CIは未確認 |
| 2026-09-19 | Task 2.2.1：基本モデル・認証主体・型を定義 | Prisma検証・生成、lint・型チェック・既存14テスト・SELECT 1成功。空スキーマとの差分SQLを確認。DB適用なし |


## 6. Task 2.1.3：検証コマンド・テスト・CI

### 6.1 到達点と実装範囲

Node.jsを`.nvmrc`で22.23.1に固定し、package.jsonのenginesで22.23.1以上・23未満を指定した。GitHub Actionsも`.nvmrc`を参照する。既存のNext.js・Prismaの版は変更していない。

今回のテストはNode.js標準の`node:test`と既存のtsxを使用する。UIはまだ初期画面のため、DOMテスト用の依存は追加せず、現在実装済みの接続先制限と秘密情報の非出力を検証する。今後の業務ロジックは単体テスト、実際の予約競合はPostgreSQL統合テスト、画面フローはE2Eへ追加する。

### 6.2 コマンド

| コマンド | 内容・前提 |
| --- | --- |
| `npm ci` | lockfileから依存を再現。ネットワークまたはnpmキャッシュが必要 |
| `npm run check` | schema検証→Client生成→lint→型生成・型チェック→テスト。DB起動は不要だがDIRECT_URLの設定は必要 |
| `npm run typecheck` | `next typegen`の後に`tsc --noEmit --incremental false`。既存の.next型生成結果に依存しない |
| `npm test` | `node --import tsx --test tests/*.test.ts`。現在14件、DB接続不要 |
| `npm run test:watch` | 開発中の継続テスト |
| `npm run db:check` | 稼働中のローカルDBにSELECT 1。データ更新なし |
| `npm run build` | 本番ビルド。現在はGoogle Fontsの取得にネットワークが必要 |
| `npm run audit:dependencies` | 全依存の監査。high以上で失敗し、既知の指摘を黙って除外しない |

ハンズオンは`.env`のローカル設定を確認したうえで次の順序とする。既存ファイルにサンプルを上書きしない。

```bash
npm ci
npm run check
npm run db:up
npm run db:check
npm run build
npm run audit:dependencies
```

監査は第7章の修正後、ローカルでは0件で成功した。将来の指摘による失敗は、テスト失敗やDB接続失敗とは別に対応する。`npm audit fix --force`はこの手順に含めない。

### 6.3 接続先ガードの回帰テスト

`scripts/check-db.ts`の判定を`scripts/lib/local-database.ts`へ分離した。テスト可能にすると同時に、重複したschema指定とURLフラグメントも拒否するようにした。新たに追加した`tests/local-database.test.ts`で次を確認する。

- ローカルのIPv4・IPv6・localhost、許可されたDB・schemaは受理する。
- 未設定、不正URL、外部host、似せたhost、別DB・port・protocol、host上書き、別schema、schema重複、fragmentを拒否する。
- 実際のCLIを子プロセスで実行し、外部接続指定時は終了コード1かつ資格情報を出力しない。
- サーバー用条件なしでPrismaモジュールを読むとserver-onlyで拒否する。

CLIの正常系は`db:check`で実DBに対して確認する。拒否テストだけで接続可能とは判断しない。業務予約ロジックを実装前にテストしたとは扱わない。

### 6.4 GitHub Actions

`.github/workflows/ci.yml`を追加。push・pull_request・手動実行で起動する。

| job | 実行内容 |
| --- | --- |
| checks | checkout→Node設定→npm ci→check→db:check→build |
| dependency-audit | checkout→Node設定→依存監査。high以上の指摘がある場合は失敗する |

checksではPostgreSQL 17サービスを用意し、CI専用のローカル接続変数を設定する。実運用のDB・秘密情報は使わない。ヘルスチェック後に疎通を実行し、migrationはまだ実行しない。

contents権限はreadのみ、checkoutの資格情報永続化を無効化。同じ参照先の新実行で前の実行を中止する。タイムアウトはchecks 20分、監査10分。監査をcontinue-on-errorで成功扱いにしない。初回CIではhigh 4件で失敗したが、第7章で修正し、ローカル監査は成功した。修正後のGitHub上の再実行は未確認。

[checkout](https://github.com/actions/checkout)・[setup-node](https://github.com/actions/setup-node)の公式手順を確認し、v7を使用した。Next.jsの型生成は同梱CLIガイドの`next typegen`に従った。

YAMLの構文解析は成功したが、GitHub上の実行・ブランチ保護の必須チェック設定は未確認。ローカル結果をGitHubの成功結果とみなさない。

### 6.5 クリーンインストールからの確認結果

作業ディレクトリとは別の一時ディレクトリへ追跡対象と今回の新規ファイルをコピーし、node_modules・.next・実際の.envを持ち込まず確認した。接続設定は.env.exampleを使用。Node.js 22.23.1、npm 10.9.8、macOSでの結果。

| 確認 | 結果 |
| --- | --- |
| 作業ディレクトリのcheck | schema・生成・lint・型チェック・14テスト成功 |
| 隔離コピーのnpm ci | 成功。lockfileによるインストールを再現 |
| 隔離コピーのcheck | 14件すべて成功、lint・型チェック成功 |
| 隔離コピーのdb:check | 既存ローカルPostgreSQLへのSELECT 1成功 |
| 隔離コピーのbuild | 成功。`/`と`/_not-found`を静的生成 |
| CI YAML構文解析 | 成功 |
| 依存監査 | high 4件、未解消 |

最初の作業ディレクトリでのbuildはsandboxからGoogle Fontsへ到達できず失敗した。ネットワークを許可した隔離コピーで再実行して成功した。フォント取得をモックしたり既存のデザインを変更したりして成功扱いにはしていない。

ブラウザ表示・本番デプロイ・予約機能・GitHubホスト上のCIは未検証。新規インストール時にESLint 9.39.5のサポート終了警告も表示されたため、Next.jsのESLint設定との互換性を確認して別途更新対象とする。

### 6.6 初回の依存監査と判断（第7章で対応済み）

2026-09-17にnpm auditと配布バージョンを再確認した。

| 指摘 | 現状 |
| --- | --- |
| deepmerge-ts | Prismaの@prisma/config経由で7.1.5。再帰オブジェクトのスタック枯渇。修正範囲は8系 |
| mysql2 | Prisma CLI経由で3.15.3。認証プラグイン降格、圧縮処理の指摘 |
| @prisma/config・prisma | 上記依存の影響を受けるパッケージとしてhigh集計に含まれる |

4件は独立した4種類の脆弱性という意味ではなく、影響する依存パッケージ数。アプリのDB接続はpgでありMySQL2を使っていないが、CLI依存が解消済みとは扱わない。

auditの自動修正候補はPrisma 6.19.3へのmajor変更、配布のlatestは8.0.0-rc.15だった。今回の7.10.0設計からの降格・RCへの移行は実行しない。deepmerge-tsのmajor overrideも互換性確認なしでは適用しない。

初回は対応を保留したが、CI失敗の報告を受け第7章の限定overrideを実施した。この節の指摘件数は修正前の記録。監査jobの判定基準は変更していない。

参照：[deepmerge-ts advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)、[MySQL2認証](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)、[MySQL2圧縮](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)。

### 6.7 次の進め方

Task 2.1.3完了時点では、次の作業をTask 2.1.4のREADME第2・10章へのセットアップ・検証手順統合とした（実施記録は第8章）。Task 2.1.3は手順・テスト・CIファイルの整備とローカル再現を完了として記録し、修正後のGitHub実行確認は残課題として継続する。依存監査の解消結果は第7章を参照する。


## 7. dependency-auditの失敗への対応

2026-09-17、利用者からGitHub CIのdependency-auditがhigh 4件で失敗した報告を受け、依存を修正した。監査レベルやCIの失敗判定は緩めていない。

### 7.1 変更内容

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| Prisma CLI | ^7.10.0（実体7.10.0） | 7.10.0に正確に固定 |
| @prisma/config@7.10.0配下のdeepmerge-ts | 7.1.5 | overrideで8.0.2 |
| prisma@7.10.0配下のmysql2 | 3.15.3 | overrideで3.24.4 |

package.jsonとpackage-lock.jsonを更新。Prisma 6への降格、Prisma 8 RCへの移行、全依存を対象にしたoverrideは行っていない。Prisma Client・pgアダプターの実体は7.10.0を維持する。

npmは直接依存の指定と競合するoverrideを拒否するため、CLIの直接指定を現行の7.10.0へ固定した。overrideも親の版を限定し、将来のPrisma更新へ無条件で持ち越さない。

### 7.2 互換性確認の範囲

deepmerge-ts 8はmajor更新。[公式リリースノート](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)ではMap値の深いマージや型名・deepmergeIntoの挙動変更がある。インストール済み@prisma/configの実装がdeepmergeを設定ローダーへ渡すことを確認した。現在のprisma7.config.tsは通常のオブジェクトで、Map・カスタム型・deepmergeIntoを使用していない。

Prismaから解決されるdeepmergeの通常設定マージと、循環入力によるスタック枯渇が発生しないことを確認した。加えて実際のCLI設定読込・schema検証・Client生成を実行した。今後、設定の表現を拡張する場合は再検証する。

MySQL2はアプリのPostgreSQL接続では使わないが、CLIの依存として修正版へ更新した。MySQLサーバーとの通信を検証したわけではない。DBの業務モデル・migrationは未作成のため、今回migrationの適用・巻戻しは行っていない。

### 7.3 検証結果

- `npm ci`：更新したlockfileからクリーンインストール成功。
- `npm run audit:dependencies`：終了コード0、found 0 vulnerabilities。
- `npm ls prisma @prisma/config deepmerge-ts mysql2`：7.10.0／7.10.0／8.0.2／3.24.4、override適用を確認。
- `npm run check`：Prisma検証・生成、lint、型チェック、14テストが成功。
- `npm run db:check`：既存ローカルPostgreSQLへのSELECT 1成功。データ更新なし。
- `npm run build`：隔離コピーでクリーンインストール後に成功。`/`と`/_not-found`を静的生成。

作業ディレクトリでのbuildはTurbopackの処理中にポートの権限制限で停止した。node_modules・.next・実際の.envを持ち込まない一時ディレクトリへコピーし、.env.exampleを使ってnpm ciとbuildを再実行して成功した。

修正後のGitHub CIは、この差分をcommit・pushして新しい実行で確認する必要がある。古いcommitの失敗ジョブを再実行するだけでは新しいlockfileは使われない。今回commit・push・GitHub再実行は行っていない。

### 7.4 overrideの管理

Prisma更新時は上流の依存修正状況を調べ、修正済みならoverrideを除去してlockfileを再生成する。npm ci・監査・check・DB疎通・buildを再確認する。監査を通す目的でPrismaのmajorを自動変更しない。現時点の0件は将来の脆弱性不存在を保証しないため、既存のCI監査を継続する。

## 8. Task 2.1.4：READMEへのセットアップ・起動・検証手順の統合

### 8.1 目的・完了条件

初めて取得した開発者がREADME第2・10章だけで必要な実行環境と設定を把握し、DB起動・アプリ起動・静的チェック・テスト・ビルドを再現できる状態にする。詳細設計は判断の根拠と実行結果を保持し、READMEを日常の手順の入口とする。

対象は文書の整備と既存コマンドの実行確認。業務モデル・画面・認証・migration・seedの追加はStory 2.2以降で扱う。GitHub上のCI成功、本番デプロイ、予約機能の成功は今回のローカル確認に含めない。

### 8.2 文書構成と設計判断

| 更新箇所 | 記載内容・理由 |
| --- | --- |
| README冒頭・第2章 | 設計予定と整備済みの環境を区別。Node・npm・主要依存・Compose・CIを明示 |
| README第10章：初回 | リポジトリルート、実行環境、非上書きの`.env`準備、`npm ci`、DB起動、`check`、DB疎通の順に統一 |
| README第10章：日常 | dev起動、期待する初期画面、Ctrl+C、データを保持するDB停止手順 |
| README第10章：検証 | 各コマンドの役割・前提、build後のstart、CIとの対応、トラブル時の確認先 |
| README第10章：後続 | 本番構成・認証・メール設定の導入時期を示し、未導入の秘密情報を初回セットアップで要求しない |
| README第15章・本書 | 実測結果を記録してからTaskの完了を反映 |

初回の`check`にClient生成が含まれるため、同じ手順で`db:generate`を重ねて必須にしない。個別に再生成するコマンドは一覧へ残す。Next.js 16のbuildではlintを実行しないため、`check`とbuildは別の確認とする。

環境変数は既存`.env`を保持し、`.env.example`を初回だけ利用する。Next.jsとPrisma CLIの読込差、シェル変数による上書き、ローカルDBの接続先ガードを説明する。接続文字列の実値は検証ログ・本書へ転載しない。

現行トップページはDBを参照しないため、画面表示と`SELECT 1`を別々の完了条件とする。開発サーバーとbuildの並行実行による生成物の干渉を避け、devを停止してからbuild・startを確認する。

参照したローカル資料：Next.js同梱の`01-app/01-getting-started/01-installation.md`と`01-app/03-api-reference/06-cli/next.md`、Prisma CLIスキルの`references/generate.md`・`references/validate.md`。コマンドの実体は`package.json`・Compose・CI設定と照合した。

### 8.3 再現確認の方法

2026-09-19、追跡ファイルを`/private/tmp/booking-task214-0ev0_3yy`へコピーし、既存node_modules・.next・実際の.envを持ち込まず確認した。接続設定は.env.exampleから作成。Node.js 22.23.2、npm 10.9.8、Docker Compose 5.1.0、macOSを使用。Node.jsはenginesの範囲内だが、.nvmrcの22.23.1そのものの再検証ではない（22.23.1での既存結果は第6章）。

DBの起動だけは元のプロジェクトルートで`npm run db:up`を実行し、隔離コピーから同じDBへ接続する。別のComposeプロジェクトを同じ5432番へ起動しない。今回のDocker環境ではイメージ取得、`booking_sample_postgres_data`ボリュームとコンテナの新規作成後にhealthyとなった。第3章の実行時とは環境の状態が異なり、既存データを削除・リセットした結果ではない。

### 8.4 検証結果

| 確認 | 結果 |
| --- | --- |
| `npm ci` | 隔離コピーで成功。lockfileを変更せず506パッケージ導入 |
| `npm run db:up` | 元のプロジェクトでPostgreSQL起動・healthy |
| `npm run check` | schema検証・Client生成・lint・型生成／型チェック・14テスト成功 |
| `npm run db:check` | 隔離コピーからローカルDBへのSELECT 1成功。業務データの更新なし |
| `npm run dev -- --hostname 127.0.0.1 --port 3001` | 起動成功。curlで`/`のHTTP 200と初期画面の文言を確認後、Ctrl+Cで停止 |
| `npm run build` | 成功。`/`と`/_not-found`を静的生成 |
| `npm run audit:dependencies` | 終了コード0、found 0 vulnerabilities |
| `npm run start -- --hostname 127.0.0.1 --port 3001` | build後に起動成功。HTTP 200と同じ初期画面の文言を確認後、Ctrl+Cで停止 |
| 文書の照合 | 記載したnpmスクリプト名とpackage.jsonの一致、相対リンク先ファイルの存在、`git diff --check`を確認 |

検証サーバーはループバックの3001番に限定し、READMEにも別ポートの指定例を記載した。ブラウザツールに利用可能なブラウザがなかったため、HTML応答の内容までを確認範囲とし、見た目・ブラウザ内動作の検証は未実施。

実行環境のsandboxによりDockerソケット・Prismaキャッシュ・npm監査への通信・サーバーのポート利用が拒否されたが、権限を許可して再実行し成功した。buildは最初にGoogle Fontsへの通信制限で失敗し、権限を許可した再実行でもTurbopackのポート利用エラーが出た。失敗時の`.next`を隔離コピー内の`.next-task214-failed`へ退避し、権限を許可して再ビルドすると成功した。原因をアプリの不具合と断定せず、検証環境の制限と生成キャッシュの影響を切り分けた記録とする。

アプリコード・依存・CI設定・既存.envは変更していない。検証用Webサーバーは停止済みで、ローカルPostgreSQLは次のハンズオンに利用できるよう稼働を継続。`db:down`は既存スクリプトとComposeのボリューム定義を照合したが、今回は実行していない。ESLint 9.39.5のサポート終了警告は継続課題。GitHub CI・本番デプロイ・業務機能は未検証。

### 8.5 完了判断と次のTask

READMEのセットアップからDB疎通・静的検証・開発起動・本番ビルドと起動まで再現できたため、Task 2.1.4およびStory 2.1のローカル再現の完了条件を満たした。今回のNodeパッチ版差とブラウザ目視未確認は第8.3・8.4節のとおり。GitHub実行結果は別途確認を継続する。

次はTask 2.2.1で、README第9・11章とEpic 1詳細設計を基に会員・予約・認証等のPrismaモデル、日時・料金の型を定義する。今回のTaskではその実装を先取りしない。

## 9. Task 2.2.1：基本モデル・認証主体・型の定義

### 9.1 目的と今回の範囲

README第9・11章およびEpic 1詳細設計第9・11・12・14章の採用事項を、`prisma/schema.prisma`へ落とし込む。会員との必須関連、会員・予約状態、認証主体と失効用セッション、日時・整数円の型を定義し、schema検証・Client生成・既存チェックと生成SQLの確認までを完了条件とする。

今回のスキーマはStory 2.2の途中段階。スナップショットは2.2.2、占有枠と検索索引は2.2.3、migration・seed・DB制約の実動作は2.2.4、権限・トークン・退会／施術実績・通知／監査は2.2.5、適用日付き設定は2.2.6で実装する。今回の定義だけで予約保存APIを実装・公開しない。既存DBへ`db push`やmigrationを実行しない。

### 9.2 モデルと関連

| モデル | 今回定義する内容 |
| --- | --- |
| Member | 入会必須情報、表示用メール・氏名と照合キー、ハッシュ、会員状態、退会フラグ、メール確認・初回有効化日時、認証版 |
| StaffAccount | スタッフ専用資格情報、メール照合キー、有効状態、認証版。管理者への昇格用role列は持たない |
| AdminAccount | 管理者の固定監査用ID・表示名・有効状態。資格情報はDBへ保存しない |
| AppSession | JWTと照合するアプリ独自のセッションID、主体種別・FK、発行時認証版、作成・絶対期限・失効日時 |
| Room / Therapist | 部屋／施術者の名称と有効状態。施術者とログイン用スタッフは別の概念 |
| Treatment / Option | 名称、整数の施術／追加時間・税込料金、有効状態 |
| Reservation | 必須の会員・メニュー・部屋・施術者、状態、営業日、予定時点、合計時間・料金・枠数、備考、更新競合検出用の版 |
| ReservationOption | 明示的な予約とオプションの中間モデル。複合主キーで同一オプションの重複を禁止 |

会員1人に予約は複数件。`Reservation.memberId`と`member`の両方を非nullableにし、会員のない予約を型・生成される外部キー定義で許容しない。メニューは予約ごとに1件、部屋・施術者も1件ずつを必須にする。オプションは0件以上。

全関連で`onDelete: Restrict, onUpdate: Restrict`を明示する。参照先の削除で予約やセッションを連鎖削除せず、IDは不変とする。ただし参照がない行の物理削除まで禁止する指定ではない。業務上の論理削除・マスタ無効化はサービス層でも徹底する。スナップショット追加時に履歴保持の参照関係を再確認する。

IDは`String @db.Uuid`、通常は`@default(uuid())`でClient側生成。AdminAccountだけはseedで安定したUUIDを明示するため自動生成を付けない。UUIDは認可の代わりにはならない。テーブル・列名はPrismaのモデル名・camelCaseをそのまま使い、今回はmapによる別名を設けない。

### 9.3 状態と会員情報

`MemberStatus`は`PENDING_EMAIL`・`PENDING_REVIEW`・`REJECTED`・`ACTIVE`・`WITHDRAWN`・`RESTORE_PENDING`の6値。初期値は`PENDING_EMAIL`、`isDeleted`はfalse。退会中・復旧待ちだけisDeleted=trueとし、ACTIVEには確認日時・初回有効化日時を要求する。これらの列間条件はmigration時のCHECKとサービス層の遷移処理で保証する。

`firstActivatedAt`は最初にACTIVEへ到達した日時を保持し、復旧後も上書きしない。未成立の登録を退会扱いにしてから復旧することで審査を迂回させないための判定に使う。退会種別・理由・復旧世代等はイベントモデルと合わせてTask 2.2.5で追加する。

`ReservationStatus`は`CONFIRMED`・`IN_PROGRESS`・`COMPLETED`・`CANCELLED`の4値、初期値はCONFIRMED。要調整・メール配信状態はこのenumに混ぜない。施術開始・完了・取消実績は予定時点を流用せずTask 2.2.5で別項目を追加する。enumは値の集合を限定するだけで、禁止遷移の阻止や予約取消時の枠解放を実装するものではない。

メールは配送用`email`と小文字化済みの照合用`emailKey`を分離する。emailKeyの一意制約は未確認・退会済みを含む全行に適用する。スタッフの一意性はStaffAccount内で独立し、会員とのメール一致で統合しない。正規化自体はDBが自動で行うわけではなく、入会・更新サービスで適用する。

氏名は姓・名を各100文字の表示用に保存し、NFKC等の正規化後の照合キーは`Text`とする。正規化で長さが増えても切り捨てない。氏名の一意制約は設けない。電話番号・郵便番号は先頭0を保持する文字列、年代は`SmallInt`で20・30・40・50・60・70・80に限定するCHECKを後続migrationで追加する。

### 9.4 認証モデルの選択

採用済みのCredentials＋JWT＋独自失効記録に従い、Auth.jsのPrisma Adapter用User／Account／Sessionを追加しない。`AppSession`はアプリ自身が作成・照合・失効する。NextAuthの導入・版固定・ログイン機能はStory 3.1／3.3で行う。

管理者をStaffAccountのnullableパスワードやroleで表現する代わりに、AdminAccountへ分離する。これによりスタッフのハッシュは必須のまま、管理者テーブルにはメール・パスワードの保存欄を作らずに済む。seedで1件の固定管理者IDを用意し、管理者ログインはそのIDと環境変数資格情報を対応させる。DBに管理者行を追加しただけではログインできない。初期リリースの管理者を増やすAPIは設けない。

`PrincipalType`はMEMBER・STAFF・ADMIN。AppSessionには3つのnullable FKを持たせ、対応する主体だけを指定する。汎用の文字列subjectIdだけで外部キー検証を失わないようにする。**ちょうど1つのFKが非NULLかつ種別と一致するCHECKが必要**で、Task 2.2.4のmigrationへ追加する。Prisma定義だけではこの条件を保証できないため、適用前の必須残作業として管理する。

認証版は1以上の整数。会員・スタッフは各レコードのauthVersion、管理者は`ADMIN_AUTH_VERSION`を正の整数として読み、発行時の値をAppSessionへ記録する。管理者の認証版をDBへ二重保持しない。期限は会員7日、スタッフ・管理者8時間をサービス側で計算してexpiresAtに保存し、JWT更新で延長しない。JWT文字列・Cookie・平文パスワードは保存しない。

### 9.5 日時・金額・文字列の型

| 用途 | Prisma / PostgreSQL | 適用・制約 |
| --- | --- | --- |
| 予定・確認・作成・更新・セッションの時点 | `DateTime @db.Timestamptz(3)` | UTCの時点、ミリ秒精度。Asia/Tokyoの表示・入力変換はサービス側 |
| 予約の営業日 | `DateTime @db.Date` | Asia/Tokyoでの予約対象日。startsAtからUTCの日付を切り出さない |
| 開閉店・休憩の時刻（後続） | `DateTime @db.Time(0)` | Task 2.2.5／2.2.6で設定モデルとともに定義。正時・日内・休憩60分を検証 |
| 時間・料金・枠数・版 | `Int` / integer | 税込円・分。浮動小数やmoneyは使わない |
| メール・氏名・電話・郵便・備考 | `String @db.VarChar(n)` | 上限254／100／11／7／1000。最小長・数字・書式は別途検証 |
| パスワードハッシュ・氏名照合キー | `String @db.Text` | ハッシュ方式のパラメータや正規化による拡張を切り捨てない |

名称（部屋・施術者・メニュー・オプション・店舗利用者表示名）は今回1〜100 Unicodeコードポイントを上限設計として採用。DBには上限を定義し、空欄・制御文字等の入力規則は各管理機能の実装時に検証する。

時間はメニュー・合計1〜1380分、オプション0〜1380分、料金・合計0〜1,000,000円、slotCountは1〜23とする。予約の終了は`startsAt + totalDurationMinutes`、占有終了は`startsAt + slotCount × 60分`、枠数は切り上げ計算で整合させる。数値範囲・計算結果・営業日一致を型だけで保証できるとは扱わない。

`DateTime @db.Date`もClientではDateとして扱う。日付のみの入出力では明示的な変換を使い、マシンのローカルタイムゾーンに依存させない。createdAtの`now()`はDBデフォルト、updatedAtの`@updatedAt`はPrisma側の更新機能であり、SQLを直接更新した場合のトリガーではない。SQL利用時は更新日時も明示する。

参考：[Prisma Schema API](https://docs.prisma.io/docs/orm/reference/prisma-schema-reference)、[PostgreSQL型対応](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)。Webの型対応と、採用中のPrisma 7.10.0による検証・生成SQLを照合する。

### 9.6 後続Taskへ渡す制約と確認項目

| Task | 必須の後続作業 |
| --- | --- |
| 2.2.2 | 予約時の連絡先・メニュー／オプションの名称・時間・料金を複写する列、無効化後の履歴参照。郵便番号・年代の複写要否も決める |
| 2.2.3 | ReservationSlot、部屋／施術者の枠一意制約、FK列・検索条件に沿う索引。予約と枠の割当先一致 |
| 2.2.4 | 今回のNOT NULL・FK・enum・メール一意性をDBで実証。正数・年代・文字書式・会員状態整合、Session主体の排他・種別一致・期限順序、予約の時間／金額／枠数／営業日のCHECKを追加し正常／拒否系を検証 |
| 2.2.5 | 操作別権限、用途別トークン、氏名審査、退会・復旧履歴、施術／取消実績、要調整・配信・監査、レート制限等の運用モデル |
| 2.2.6 | 曜日／日別営業・休憩の適用日付き履歴、版・取消・変更との関連。単純な現在値で先に固定しない |

非有効会員の予約禁止、無効資源の割当禁止、会員と予約の状態遷移、期限・営業設定・休憩・同時更新などのテーブル間・時刻依存ルールは、CHECKだけでは完結しない。Story 4.2のトランザクション内再検証とDB統合テストへ引き継ぐ。

### 9.7 ハンズオンと検証結果

1. Memberの必須項目・6状態と、Reservationからの必須関連を読む。
2. 60分6,000円の施術へ10分1,000円のオプションを付ける例を考える。合計70分・7,000円・2枠、09:00開始なら施術終了10:10・占有終了11:00。日本時間の09:00をUTCの00:00としてstartsAtへ保存する。
3. `npm run db:validate`で定義、`npm run db:generate`でClientを確認する。これらはテーブル作成ではない。
4. `npm run check`で既存コードとの型整合とテストを確認する。
5. 下記コマンドで空スキーマとの差分SQLを出力し、NOT NULL・外部キー・enum・Timestamptzの型を読む。SQLは今回DBへ適用しない。

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --config prisma7.config.ts
```

2026-09-19、Node.js 22.23.2／Prisma 7.10.0で実施。

| 確認 | 結果 |
| --- | --- |
| `prisma format --config prisma7.config.ts` | 整形成功 |
| `npm run check` | schema valid、Client生成、lint・型チェック・既存14テスト成功 |
| 空スキーマからの`migrate diff --script` | 成功。10テーブル・3enum、メール照合キーの一意索引2つ、9本の外部キーを確認 |
| SQLの型・必須関連 | Reservation.memberIdがUUID NOT NULLかつMemberへのFK。営業日DATE、時点TIMESTAMPTZ(3)、料金INTEGER、関連の削除・更新はRESTRICT |
| 生成された作成入力型 | ReservationCreateInputはmember必須、UncheckedCreateInputもmemberId必須であることを確認 |
| `npm run db:check` | 再生成ClientでSELECT 1成功。sandbox内では接続できず、権限を許可した再実行で成功 |
| 文書・差分 | npmコマンド名・相対リンク先を照合。README・詳細設計・schemaの`git diff --check`成功 |

差分SQLは`/private/tmp/booking-task221-schema.sql`へ出力し、DBには実行していない。生成SQLにCHECKがまだないことも確認した。既存の14テストは接続先制限等のテストであり、新モデルのDB制約・状態遷移を実証するものではない。モデルを使ったCRUD・DB拒否系はmigration後に検証する。

既存リポジトリがClient生成物を追跡しているため、`src/generated/prisma/`を再生成して追加モデルの型を含めた。手編集はしていない。全差分の`git diff --check`はPrismaが生成するコメント等の行末空白を指摘するため、手書きの3ファイルと生成物を区別して記録した。schemaから再生成できる状態を維持する。

今回build・ブラウザ・GitHub CIは再実行していない。アプリの描画コードや依存は変更せず、schemaと生成型の整合を中心に検証した。既存.env・DBデータは変更していない。

### 9.8 完了判断と次のTask

Task 2.2.1の基本モデル・必須関連・状態・認証構成に必要な保存先・型を定義し、検証と生成を完了した。Story 2.2全体は未完了。次はTask 2.2.2で、予約時点の氏名・連絡先・メニュー／オプションの名称・時間・料金を保存する列と、履歴を保持する参照関係を具体化する。

## 10. Task 2.2.2：予約スナップショットと履歴参照の定義

### 10.1 今回の実装範囲

2026-09-28、`prisma/schema.prisma`のReservationへ9項目、ReservationOptionへ3項目を追加した。予約時点の値と現在の会員・マスタ情報を区別するため、複写項目には`Snapshot`接尾辞を付ける。既存の必須FK・Restrict・オプションの複合主キーを維持し、追跡済みのPrisma Clientを再生成した。

今回は保存先と参照関係の定義まで。以下の複写・更新・表示方針は後続サービスの実装契約であり、予約APIや画面が完成したことを意味しない。migration・seed・DB適用はTask 2.2.4で行う。

### 10.2 複写項目と型

すべて非nullable・デフォルト値なし。空文字や0を自動補完して複写漏れを隠さず、作成時に明示的な値を要求する。名称等の上限は第9章の複写元と一致させる。

| 保存先 | 項目 | 複写元 | 型・単位 |
| --- | --- | --- | --- |
| Reservation | `memberLastNameSnapshot` | Member.lastName | String / varchar(100) |
| Reservation | `memberFirstNameSnapshot` | Member.firstName | String / varchar(100) |
| Reservation | `memberEmailSnapshot` | Member.email（配送用） | String / varchar(254) |
| Reservation | `memberPhoneNumberSnapshot` | Member.phoneNumber | String / varchar(11)、先頭0を保持 |
| Reservation | `treatmentNameSnapshot` | Treatment.name | String / varchar(100) |
| Reservation | `treatmentDurationMinutesSnapshot` | Treatment.durationMinutes | Int / integer、分 |
| Reservation | `treatmentPriceYenSnapshot` | Treatment.priceYen | Int / integer、税込円 |
| Reservation | `roomNameSnapshot` | Room.name | String / varchar(100) |
| Reservation | `therapistNameSnapshot` | Therapist.name | String / varchar(100) |
| ReservationOption | `optionNameSnapshot` | Option.name | String / varchar(100) |
| ReservationOption | `optionDurationMinutesSnapshot` | Option.durationMinutes | Int / integer、分。0分を許容 |
| ReservationOption | `optionPriceYenSnapshot` | Option.priceYen | Int / integer、税込円。0円を許容 |

部屋・施術者の名称も複写し、改名後に過去の割当表示が変わらないようにする。IDは同一資源の追跡、名称は予約内容の表示に使う。

郵便番号・年代はMemberだけに保持し、予約へ複写しない。現時点の予約受付・連絡・履歴表示には必要なく、予約時点の地域・年代別分析も要件にないため。後から会員の現在値を参照しても「予約時点の値」とは扱わない。認証用のハッシュ、メール・氏名照合キー、会員状態も複写しない。予約権限は常に現在の会員状態で判定する。

### 10.3 参照関係と退会・無効化後の扱い

| 参照元 → 参照先 | 必須性・制約 | 履歴保持 |
| --- | --- | --- |
| Reservation → Member | memberId必須、削除・ID更新Restrict | 退会・復旧でも同じ会員IDを保持 |
| Reservation → Treatment | treatmentId必須、削除・ID更新Restrict | メニュー無効化後も関連と複写値を保持 |
| Reservation → Room / Therapist | 各ID必須、削除・ID更新Restrict | 無効化で割当FKや枠を自動削除しない。影響予約の要調整は後続Task |
| ReservationOption → Reservation / Option | 各ID必須、削除・ID更新Restrict | オプション無効化後も選択履歴を保持 |

`@@id([reservationId, optionId])`により同じオプションは1予約につき1件。選択しない場合はReservationOptionを0件とし、NULLやダミーの明細を作らない。

会員は退会状態・削除フラグ、マスタはisActive=falseで扱う。過去の予約取得に参照先のACTIVE／isActive=true条件を付けて履歴を消さず、保存済みのSnapshotを表示する。無効なマスタは新規候補・新規割当から除外する。取消・完了・退会でも予約本体とオプション明細は保持し、取消時に解放するのは占有枠である。

Restrictは参照される行の物理削除・ID更新を阻止する定義であり、参照のない予約の物理削除やSnapshotのUPDATEを禁止するものではない。論理削除・履歴保持・更新可能な状態の制限はサービス層でも実装する。今回のSchemaだけで履歴の不変性まで保証したとは扱わない。

### 10.4 後続の保存・変更・表示処理の契約

- 新規予約時、サーバーが会員と選択マスタの有効性を検証し、同じトランザクション内で値を複写する。クライアント送信の氏名・単価・名称をそのまま信用しない。予約本体・選択明細・占有枠をまとめて保存する（Story 4.2）。
- 合計時間はメニューの時間Snapshot＋選択オプションの時間Snapshotの総和、合計料金も同様に算出し、既存のtotalDurationMinutes／totalPriceYenへ保存する。終了時刻・枠数は第9章の計算規則を使う（Story 4.1）。履歴表示時に現在のマスタ料金から再計算しない。
- 会員プロフィール・マスタの編集、退会・無効化では既存予約のSnapshotを一括更新しない。備考・状態だけの更新でも複写し直さない。
- 明示的な予約変更では、変更対象となるメニュー・オプション・割当先のIDとSnapshotを一緒に保存する。変更していない項目は保持し、日時のみの変更で料金や連絡先を自動的に現在値へ置き換えない。選択を変える際は、新たに選ぶ項目の現在値と保持する項目のSnapshotから合計を算出し、確定前に内容を確認する。
- 予約を変更しても会員IDと予約時点の氏名・連絡先は維持する。Snapshotは最新の確定済み予約内容であり、変更前の各版をすべて格納するものではない。変更前後・操作者・理由はTask 2.2.5の操作記録とStory 4.2で記録する。完了・取消済みを変更可能にするAPIは今回追加しない。
- 保存済みの連絡先は履歴用であり、認証・会員確認・パスワード再設定の送信先決定には使わない。通知用途ごとの宛先取得と送信時の確認はStory 3.4で実装する。

### 10.5 ハンズオン手順と検証結果

1. `prisma/schema.prisma`のReservationとReservationOptionで、必須FKとSnapshotの役割を比較する。
2. 「全身60分・6,000円」に「延長10分・1,000円」「ホットストーン0分・500円」を選ぶ例を読む。予約にはメニュー60分・6,000円、各明細には10分・1,000円と0分・500円を複写し、合計70分・7,500円・2枠を保存する。09:00開始なら施術終了10:10、占有終了11:00となる。
3. その後メニューが90分・8,000円へ改定されても、保存済み予約は70分・7,500円のままとなる設計を確認する。これは設計例であり、実DB操作の結果ではない。
4. 以下を実行し、SQLのSnapshot列と末尾の外部キー定義を確認する。`migrate diff`はSQL出力だけで、DBへの適用は行わない。

```bash
npm run check
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --config prisma7.config.ts --output /private/tmp/booking-task222-schema.sql
```

2026-09-28、Node.js 22.23.1／Prisma 7.10.0で確認した。

| 確認 | 結果 |
| --- | --- |
| `prisma format --config prisma7.config.ts` | 整形成功 |
| `npm run check` | Schema検証・Client生成・lint・型チェック・既存14テスト成功 |
| `migrate diff --from-empty` | SQL生成成功。DB接続・適用なし |
| 生成SQLの12列 | 全てNOT NULL・デフォルトなし。文字数上限・INTEGER型を確認 |
| 生成ClientのCreateInput / UncheckedCreateInput | Reservationの9項目・ReservationOptionの3項目が双方で必須であることを確認 |
| 履歴関連の外部キー6本 | 全てON DELETE RESTRICT / ON UPDATE RESTRICT。明細の複合主キーも維持 |
| 手書きファイルの差分 | README・本書・Schemaの`git diff --check`成功 |

SQL・生成型は一時的なNodeスクリプトで機械照合した。既存14テストは接続先制限等を対象とし、予約履歴のDB動作を検証するテストではない。生成物は従来どおり手編集せず、生成コメントの行末空白は手書き差分と区別する。

今回、DBへの接続・データ更新、migration・seed、build・ブラウザ・GitHub CIは実行していない。Schema変更を理由に稼働中のDBや既存.envを変更していない。

### 10.6 後続Taskの検証と完了判断

Task 2.2.4では以下を実DBで確認する。PrismaのIntは負値も許すため、型だけで業務制約が完成したとは扱わない。

- Snapshot欠落のINSERTを拒否し、氏名・名称の長さ、電話・メール書式、メニュー1〜1380分、オプション0〜1380分、料金0〜1,000,000円のCHECKを追加・確認する。合計時間・料金にも第9章の範囲を適用する。
- 予約・明細を作成後に会員の氏名・連絡先、マスタの名称・時間・料金を更新／無効化しても、複写値とFKが維持されることを確認する。
- 参照中の会員・メニュー・部屋・施術者・オプションの削除とID更新を拒否し、明細がある予約の連鎖削除を起こさないことを確認する。
- 0分・0円のオプションを保存でき、同じ予約への同一オプション重複は複合主キーで拒否することを確認する。

親の合計と明細の総和は複数行にまたがるため単純な行CHECKだけでは保証できない。Story 4.1／4.2で計算・トランザクション・変更競合を実装し、会員／マスタ更新後の表示、日時だけの変更、選択変更、取消・退会時の履歴保持を統合テストする。

Task 2.2.2の項目・参照関係の定義と静的検証は完了。Story 2.2全体は未完了。次はTask 2.2.3でReservationSlot、部屋・施術者それぞれの枠一意制約、検索用インデックスを定義する。

## 11. Task 2.2.3：占有枠・枠一意制約・検索インデックス

### 11.1 今回の実装範囲

2026-09-28、`prisma/schema.prisma`へReservationSlotを追加し、予約との関連、部屋／施術者ごとの枠一意制約、検索用インデックスを定義した。追跡対象のPrisma Clientを再生成した。基本モデルは計11モデルとなる。

このTaskはSchema定義・生成SQLの確認まで。migration・seed・DB適用と実DBでの重複拒否はTask 2.2.4、空き検索・保存・取消のアプリ処理はStory 4.1／4.2で実装する。

### 11.2 ReservationSlotの項目と1時間枠

| 項目 | 型 | 意味 |
| --- | --- | --- |
| reservationId | String / UUID、必須 | 占有元の予約 |
| roomId | String / UUID、必須 | 予約と同じ部屋 |
| therapistId | String / UUID、必須 | 予約と同じ施術者 |
| slotStartsAt | DateTime / timestamptz(3)、必須 | 日付を含む枠開始の時点 |

1行が`[slotStartsAt, slotStartsAt + 1時間)`を占有する。終了を含めないため、09:00〜10:00の枠と10:00〜11:00の枠は隣接できる。終了日時・枠の状態・営業日は予約本体と重複保存せず、占有行の存在を競合判定に使う。固定長の枠なので専用のUUIDも追加せず、`@@id([reservationId, slotStartsAt])`を主キーとする。

営業日・候補時刻はAsia/Tokyoで計算し、slotStartsAtはUTCの時点として保存する。例：2026-10-01 09:00 JSTは`2026-10-01T00:00:00.000Z`。翌日の09:00は別の時点となり衝突しない。時刻だけの文字列を一意キーにしない。

### 11.3 二重予約と割当先不一致を防ぐ制約

| 定義 | 役割 |
| --- | --- |
| Slotの主キー `(reservationId, slotStartsAt)` | 同じ予約で同時刻の枠を重複登録させない。予約ごとの枠取得・削除にも使う |
| Slotの一意制約 `(roomId, slotStartsAt)` | 同じ部屋・同じ枠の二重確保を拒否 |
| Slotの一意制約 `(therapistId, slotStartsAt)` | 同じ施術者・同じ枠の二重確保を拒否 |
| Reservationの一意制約 `(id, roomId, therapistId)` | Slotの複合外部キーの参照先 |
| Slotの複合FK `(reservationId, roomId, therapistId)` → Reservationの `(id, roomId, therapistId)` | 枠の存在する予約と、その予約の部屋・施術者の一致を要求 |

部屋・施術者をまとめた1本の一意制約だけでは、同じ部屋を異なる施術者で確保するケースを拒否できない。このため資源ごとに独立した一意制約を置く。

Reservation.idは既に主キーだが、PostgreSQLの複合FKが参照する列組を定義するため、親側に複合一意制約を追加する。検索目的だけの重複インデックスではない。SlotからRoom／Therapistへの直接の関連は追加しない。親Reservationの必須FKと今回の複合FKを通じて資源の存在を保証し、同じ予約に属するすべての枠が同じ割当先を使う。

複合FKは`onDelete: Restrict, onUpdate: Restrict`。枠を残したまま予約本体を削除したり、部屋・施術者のIDだけを変更したりする操作はDB適用後に拒否される設計とする。予約変更は、同一トランザクション内で旧枠を削除し、予約本体の割当・Snapshot・日時等を更新してから新枠を登録する。新枠の競合で失敗したら旧枠の削除も含め全体をロールバックする。`skipDuplicates`で競合枠を飛ばして部分的に確定する処理は採用しない。

### 11.4 検索用インデックスと想定条件

通常インデックスを8本追加した。列順は先頭の等価条件と、その後の日時範囲・並び順に合わせる。

| モデル・列順 | 対象となる検索・操作 |
| --- | --- |
| Reservation `(businessDate, startsAt)` | 日別の予約一覧を開始時刻順に取得 |
| Reservation `(memberId, startsAt)` | 会員の予約履歴・今後の予約、退会時の取消候補を取得。状態は追加条件 |
| Reservation `(roomId, startsAt)` | 部屋別の予約一覧、無効化時の影響候補の取得 |
| Reservation `(therapistId, startsAt)` | 施術者別の予約一覧、無効化時の影響候補の取得 |
| Reservation `(treatmentId)` | メニューから参照予約を取得、FK参照の確認 |
| Reservation `(status, startsAt)` | 未開始／施術中等の状態別に日時範囲で取得 |
| ReservationOption `(optionId)` | オプションから参照予約を取得。既存主キーはreservationIdが先頭のため補完 |
| ReservationSlot `(slotStartsAt)` | 対象日の全資源の占有を日時範囲で取得 |

Slotの部屋別／施術者別の範囲検索には各一意インデックスを、予約別取得・枠削除には主キーを使えるため、同じ列順の通常インデックスは追加しない。Reservationの各FKについても先頭列を共有する複合索引と単列索引を重複させない。

空き検索は`slotStartsAt >= 対象日の開始時点 AND slotStartsAt < 翌日の開始時点`等で必要な枠を取得する。負荷比較は施術者別の枠数・前後の連続枠から計算する。無効化の影響候補に施術中を含める場合は、開始時刻が現在より前の予約も落とさず状態・占有終了を追加判定する。

今回の索引は想定クエリのための初期設計。実際のSQL・件数に対するEXPLAINや性能測定は未実施。認証セッション・権限・通知等の索引は、後続の運用モデルとクエリが具体化するTask 2.2.5以降で追加検討する。

### 11.5 Schemaだけでは保証しない条件と枠のライフサイクル

- **正時の整列**：一意制約は開始時点の完全一致に対して働く。09:00と09:30の重なりを単独では拒否しない。Task 2.2.4のmigrationでReservation.startsAtとReservationSlot.slotStartsAtの分・秒・ミリ秒が0となるCHECKを追加する。Asia/Tokyoの明示的な変換を用い、DBセッションのタイムゾーンに依存させない。
- **全枠の充足**：slotCount件であること、開始から1時間刻みで連続すること、予約の占有範囲内に収まることは親子・複数行にまたがる。複合FKは割当一致を保証するが、枠の欠落や余分な枠までは拒否しない。Story 4.2のトランザクション内で検証する。
- **有効状態・営業・休憩**：資源の存在と有効性は別。会員状態・休憩・営業時間・有効状態・期限は保存時に再検証する。要調整でも既存枠は保持する。
- **取消**：予約状態の更新とSlotの削除を同一トランザクションで行う。予約本体・Snapshot・ReservationOptionは残す。statusをCANCELLEDへ更新するだけでは枠は解放されない。
- **施術中・完了**：第14.4節の設計に従い元の枠を保持する。早期完了で枠を削除せず、過去の枠も自動削除しない。空き検索でCOMPLETEDの枠を除外して元の占有終了より早く再割当しない。将来の日付で検索すれば過去の枠は範囲外になる。

### 11.6 ハンズオンと検証結果

1. Schema末尾のReservationSlotを読み、主キー・2つの一意制約・複合FKを区別する。
2. 70分の予約Aが部屋R1・施術者T1を09:00から使う例を考える。09:00と10:00の2行を保存し、占有終了は11:00となる。
3. 同日10:00の予約BがR1・T2なら部屋側、R2・T1なら施術者側で競合する。R2・T2ならこの一意制約とは競合しない。同じR1・T1でも11:00または翌日09:00なら別の枠となる。営業・休憩等の別条件は引き続き必要。
4. 次を実行し、生成SQLのCREATE INDEX／CREATE UNIQUE INDEXとSlotの複合FKを読む。SQL出力はDBへの適用ではない。

```bash
npm run check
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --config prisma7.config.ts --output /private/tmp/booking-task223-schema.sql
```

2026-09-28、Node.js 22.23.1／Prisma 7.10.0で確認した。

| 確認 | 結果 |
| --- | --- |
| `prisma format --config prisma7.config.ts` | 整形成功 |
| `npm run check` | Schema検証・Client生成・lint・型チェック・既存14テスト成功 |
| 空スキーマからのSQL生成 | 成功。11テーブル、SlotのUUID必須3列・TIMESTAMPTZ(3)必須1列を確認 |
| 新しいキー・索引・関連 | Slot複合主キー、一意索引3本（部屋・施術者・親の参照先）、通常索引8本、複合FKの列順・RESTRICTを機械照合 |
| 生成Client | Slotの3種類の複合一意検索入力、必須作成項目、Reservation.slotsの関連を確認 |
| 手書き差分 | Schema・README・本書の`git diff --check`成功 |

SQL・生成型は一時的なNodeスクリプトでも照合した。生成Clientは手編集していない。既存14テストは接続先制限等の確認であり、上記の競合例をDBで実証したものではない。DB接続・適用・データ更新、build・ブラウザ・GitHub CIは今回実行していない。

### 11.7 Task 2.2.4以降へ渡す検証ケース

- 部屋だけ同じ／施術者だけ同じ／双方同じ時刻の競合、同じ予約の同時刻重複を拒否すること。
- 資源が双方異なる、隣接する枠、別日の同時刻は枠一意制約に抵触しないこと。
- 親予約がない枠、親と部屋だけ／施術者だけ異なる枠、NULLの必須項目を拒否すること。
- 枠を残した親予約の削除・割当変更を拒否し、旧枠削除→親更新→新枠作成のトランザクションが成功すること。
- 2枠目で競合する新規予約・変更をロールバックし、部分予約を残さず、変更前の予約・旧枠を復元すること。
- 分・秒・ミリ秒が0でない開始をCHECKで拒否すること。全枠の不足・過剰・飛びや状態と枠の整合はStory 4.2の統合テストへ渡す。
- 取消で枠だけを解放し、予約・明細が残ること。施術中・早期完了・要調整では枠を保持すること。

Task 2.2.3の定義・静的検証を完了した。Story 2.2の「開発用DBに作成し、枠の重複をDBで拒否できる」という完了条件はまだ未達。次はTask 2.2.4のmigration・開発用初期データと適用・再作成の検証へ進む。

## 12. Task 2.2.4：初回migration・開発用seed・DB適用と再作成検証

### 12.1 作業前の状態と実施範囲

2026-09-28、ローカルComposeのPostgreSQL 17がhealthyであることを確認。publicには空の`_prisma_migrations`だけがあり、業務テーブル・適用済みmigrationはなかった。既存.env・Composeボリュームを維持し、初回migrationと初期データを適用した。従来の章にある「DB未適用」は、そのTask実施時点の記録である。

再作成の検証では通常のpublicをリセットせず、実行ごとに生成する`booking_verify_<UUIDの32桁>`スキーマを2つ順番に作成し、それぞれ空の状態から同じmigrationを適用した。検証後は自分で作成に成功したスキーマだけを削除した。DB全体の削除、`migrate reset`、`db push`、ボリューム削除は実施していない。

### 12.2 追加・変更したファイル

| ファイル | 責務 |
| --- | --- |
| `prisma/migrations/20260928000000_initial_booking/migration.sql` | 11テーブル・3enum・既存のキー／索引／FK、追加49 CHECK。BEGIN／COMMITでDDLをまとめる |
| `prisma/migrations/migration_lock.toml` | PostgreSQL providerを固定 |
| `prisma/seed-data.ts` | 固定IDと共通seed処理。1トランザクションでupsert、既存行は空のupdateで保持 |
| `prisma/seed.ts` | ローカル接続先検証後、publicへseedを投入・Clientを切断 |
| `prisma7.config.ts` | `prisma db seed`から使うseedコマンドを登録 |
| `scripts/lib/development-database.ts` | Next.js環境読込、接続先ガード、Prisma CLIの安全な起動 |
| `scripts/migrate-local.ts` | ガード後に`migrate deploy`と`migrate status`。resetは呼ばない |
| `scripts/verify-database.ts` | 隔離スキーマで適用・再適用・seed・制約・競合・再作成を検証し後片付け |
| `tests/development-database.test.ts` | 3つの書込みCLIが外部URL・不一致・別schemaを接続前に拒否する9テスト |
| `package.json` | `db:migrate`・`db:seed`・`test:db`を追加 |
| `.github/workflows/ci.yml` | 専用PostgreSQLでDB適用・seed・統合検証を追加 |

Prisma Schemaのコメントを適用済みの状態へ更新し、Clientを再生成した。依存パッケージは追加・更新していない。

### 12.3 SQLで追加したCHECK制約

第9〜11章で後続作業としていた行単位の条件をmigrationへ実装した。Prisma Schemaに表現できないためSQLを正とし、後続migrationでも保持する。既存のNOT NULL・varchar上限・enum・一意索引・RESTRICT外部キーも実DBへ適用した。

| 対象 | 条件 |
| --- | --- |
| 氏名・名称・表示名・照合キー・ハッシュ | 空文字・半角空白だけの値・制御文字を拒否。文字数上限は既存のvarchar型 |
| 会員／スタッフのメール | 空白・@の位置等を簡易形式で検証し、emailKeyがlower(email)と一致することを要求 |
| 電話・郵便 | 電話は数字10〜11桁、郵便は数字7桁。文字列で先頭0を維持 |
| 年代 | 20・30・40・50・60・70・80 |
| 会員状態 | isDeletedがWITHDRAWN／RESTORE_PENDINGと一致。ACTIVEはメール確認・初回有効化日時が必須 |
| 認証版・予約版 | 1以上 |
| AppSessionの主体 | MEMBER／STAFF／ADMINと対応するFKだけが非NULL。主体ゼロ・複数・種別不一致を拒否 |
| AppSessionの日時 | 有限の作成・期限時点、expiresAt > createdAt。失効日時があれば作成以降の有限時点 |
| メニュー／合計時間 | 1〜1380分 |
| オプション時間 | 0〜1380分。0分を許容 |
| 料金・合計料金 | 0〜1,000,000円 |
| 予約の枠数 | 1〜23、`(totalDurationMinutes + 59) / 60`と一致 |
| 予約の時点 | 有限時点、施術終了＝開始＋合計分、占有終了＝開始＋枠数×1時間 |
| 営業日 | startsAtのAsia/Tokyoの日付と一致し、占有終了が翌日00:00を超えない |
| 予約開始・枠開始 | Asia/Tokyoでdate_trunc('hour', ...)と一致し、分・秒・ミリ秒が0 |
| Snapshot | 複写元と同じ氏名・名称・メール・電話・時間・料金の条件 |

メールのCHECKは配送可能性やメール所有権を証明しない。ハッシュのCHECKも暗号方式の検証ではない。NFKCによる氏名正規化、メール確認、パスワードハッシュ生成、会員状態遷移の認可は後続サービスで実装する。営業時間が翌日00:00まで認められるかは営業設定側で制限し、このCHECKだけで予約受付可と判断しない。

親子・複数行にまたがる「合計＝明細の総和」「枠の件数・連続性・親の占有範囲」「取消済みには枠なし」は今回のCHECKに含めない。例えば親の期間外でも正時かつ割当が一致するSlotはDB制約だけでは登録できることを検証で明示した。これらはStory 4.1／4.2のトランザクションと統合テストで保証する。会員／資源の有効状態、受付期限、営業・休憩、要調整も別途必要である。

### 12.4 開発用初期データ

| モデル | 件数・内容 |
| --- | --- |
| AdminAccount | 1件、表示名「管理者」。ID `00000000-0000-4000-8000-000000000001` |
| Room | 2件、施術ルーム1・2 |
| Therapist | 2件、施術者1・2。ログイン用StaffAccountとは別 |
| Treatment | ボディケア60分6,000円、オイルマッサージ90分9,000円、全身コース120分12,000円 |
| Option | ヘッドマッサージ10分1,000円、足つぼ20分2,000円、ホットストーン0分500円 |

全11行に固定UUIDを割り当て、seedを再実行しても増殖させない。`upsert`のupdateは空にしているため、既存の名称・料金変更やisActive=falseを維持する。手動追加された別IDの行も削除しない。seedの値を変更しただけでは既存行へ反映されないので、後続のデータ変更は明示的なmigrationや管理操作で行う。

管理者の認証情報・会員・スタッフ・セッション・予約は通常seedでは作成しない。管理者行が存在してもログイン機能はまだない。DB検証用の会員・予約は隔離スキーマにだけ作り、外部メール送信等は行わない。営業日・営業時間・休憩はモデル未定義のため、Task 2.2.5／2.2.6でモデルとseedを追加する。

### 12.5 ハンズオン手順と接続先の保護

依存導入・環境変数の準備済みなら、ルートで次を順番に実行する。

```bash
npm run db:up
npm run check
npm run db:migrate
npm run db:seed
npm run db:check
npm run test:db
```

`db:migrate`・`db:seed`・`test:db`はNext.jsの読込優先順位で両URLを取得し、ローカルhost・5432番・booking_sample・public schemaに限定する。URLの正規化後の文字列が一致することも要求するため、同じローカルDBでもlocalhostと127.0.0.1を混在させず揃える。外部接続先や任意schemaの指定は接続前に拒否する。Prisma CLIを直接呼ぶ場合の設定は引き続きdotenvであり、このガード付き手順とは区別する。

`db:migrate`の成功表示は`Local migrations applied; migration status is up to date.`。未適用だけを適用し、再実行は何もしない。seedは再実行可能。既存migrationを適用後に編集せず、変更が必要なら新しいmigrationを追加する。CHECKを失うため`db push`を代替手順にしない。

`test:db`にはローカルDB内のスキーマ作成権限が必要。接続先ガードを通過したURLを基に、実行内部だけで生成したスキーマ名へ切り替える。Prisma Clientにも同じschemaを明示する。2回の新規構築で列・制約・索引の定義が一致することを照合する。通常の終了・検証エラーではfinallyで専用スキーマを削除する。プロセス強制終了やDB停止時は後片付けできない場合があるため、失敗時は残存名を確認し、publicを削除しない。

### 12.6 実行結果と確認範囲

2026-09-28、Node.js 22.23.1／Prisma 7.10.0／Compose PostgreSQL 17で確認した。最初のDocker状態確認はsandboxのソケット制限で拒否されたため、許可された権限拡張でローカル操作を実行した。

| 検証 | 結果 |
| --- | --- |
| `npm run check` | Schema検証・Client生成・lint・型チェック・23テスト成功 |
| `npm run test:db` | 101検証項目成功。全49 CHECKの違反を各制約名で確認 |
| 枠の競合 | 部屋のみ同じ、施術者のみ同じ、同一枠重複を拒否。別資源・隣接枠・別日の同時刻は一意制約と衝突しない |
| FK・必須・enum・一意性 | 親不在・割当不一致、参照中の削除／ID変更、必須NULL、不正状態値、メール照合キー重複、同一オプション重複を拒否 |
| 履歴保持 | 会員・マスタ編集／無効化後もSnapshotと関連を維持。0分・0円のオプション明細を保存可能 |
| トランザクション | 2枠目の競合で新規予約と1枠目を残さない。変更失敗で旧割当・2枠を復元。正常な割当・日時変更も成功 |
| 同時接続 | 独立した2接続のトランザクションで同じ部屋の空き枠を確保し、先行コミット後に後続を一意制約で拒否 |
| 取消・完了 | 取消は状態更新と枠削除、予約明細保持を確認。完了だけでは枠を削除しない |
| 再作成 | 異なる2つの空スキーマに適用し、列・制約・索引が一致。各スキーマでdeployを再実行して成功 |
| seed再実行 | 件数を維持。編集済み名称・無効化フラグを上書きしない |
| 通常の開発用public | migration・seedを各2回実行して成功。管理者1・部屋2・施術者2・メニュー3・オプション3件、会員・予約・枠は0件 |
| 適用後の読取り | migration `20260928000000_initial_booking`完了、49 CHECK、残存検証スキーマ0件 |
| `npm run db:check` | アプリ共通ClientでSELECT 1成功 |
| 差分確認 | 手書きの追跡済みファイルと新規ファイルの空白検査成功 |

DB統合検証はテスト用SQLとPrisma seedを用いたもので、予約API・認証・ブラウザ操作を通した検証ではない。101項目は検証スクリプトの集計であり、`npm test`の23件とは別に実行する。今回build・依存監査・ブラウザ・本番DBへの適用は行っていない。

CIのchecksへ`db:migrate` → `db:seed` → `test:db`を追加し、既存のDB疎通・buildへ続ける。GitHub上で変更後のworkflowが実行されたことは未確認。

### 12.7 完了判断と次のTask

Task 2.2.4のmigration・開発用初期データ・ローカル適用・空スキーマからの再作成・DB制約検証を完了した。現在定義済みの基本11モデルについて、Story 2.2のDB作成と重複拒否を確認できた。Story 2.2全体には運用・設定モデルの追加が残る。

次はTask 2.2.5で、スタッフ別権限・認証トークン・退会／施術実績・要調整・通知／監査等を定義する。追加モデルは別migrationとして適用し、seedとDB検証も拡張する。営業・休憩はTask 2.2.6の適用日付き履歴と整合させ、未実装の現在値テーブルだけで先に固定しない。

## 13. Task 2.2.5：権限・認証・運用履歴・曜日設定のモデル

### 13.1 実装範囲

2026-09-28、基本11モデルへ運用・曜日設定の15モデルを追加し、計26モデル・14enumとした。Memberへ更新版・復旧世代、Reservationへ施術実績・取消情報を追加した。`20260928010000_operational_models`を新規migrationとして作成し、既存の初回migrationは変更していない。

モデルと制約・保存可能性の確認がこのTaskの範囲。認可、トークン発行／暗号化、SMTP、設定の有効版取得、退会・取消等の業務APIはまだ実装していない。DB検証の条件付きSQLを、そのまま完成済みのサービスと扱わない。

### 13.2 スタッフ権限と操作記録

`StaffPermission`は`(staffId, permission)`を主キーとし、26種類の操作をenumで限定する。第11.5節の設計識別子を大文字スネークケースへ対応させる（例：`reservation.cancel` → `RESERVATION_CANCEL`、`businessSetting.manage` → `BUSINESS_SETTING_MANAGE`）。スタッフ作成・会員の強制退会／削除／復旧・変更案内も含む。権限委譲、氏名審査、スタッフ認証情報管理のキーは作らない。

行がない操作は不許可。スタッフ作成時に権限行を自動作成しない。付与者はAdminAccountへの必須FKで限定し、付与日時を保持する。解除は現在の権限行を削除し、付与・解除の履歴をAuditLogへ同一トランザクションで記録する。現在の権限一覧はJWTへ埋め込まず、保護された要求ごとにDBで取得する。こうした認可・監査の同時保存はStory 3.1で実装する。

`AuditLog`は要求ごとのUUID requestKeyを一意にし、actorTypeと会員／スタッフ／管理者FKの排他をCHECKで保証する。SYSTEMだけは主体FKを持たない。action・targetType・targetId、時刻、許可する業務変更項目だけのchangesを保存する。対象IDは複数種別を扱う履歴識別子であり、汎用targetIdにFKはない。退会・審査・取消・要調整・送信確認からはAuditLogへのFKを置く。

UPDATE／DELETEは`audit_log_append_only`トリガーで拒否する。訂正は新しい操作記録を追加する。成功した業務更新と監査を同時確定し、失敗・拒否は秘密を除いた技術ログへ分離する。changesはJSONオブジェクトまでDBで限定するが、項目の許可リストや秘密の除外はサービス側の責務。パスワード・ハッシュ・トークン・Cookie・全会員レコードを入れない。理由は関連する履歴のreasonを参照し、不要な複写を避ける。

### 13.3 認証トークン・退会復旧・氏名審査

| モデル・項目 | 定義・利用方針 |
| --- | --- |
| AuthToken | 64桁小文字hexのSHA-256 digestを一意化。memberId／staffIdのどちらか1つだけ必須。スタッフはPASSWORD_RESETだけ |
| 用途・期限 | MEMBERSHIP_CONFIRM／RESTORE_CONFIRMは発行から最大24時間、PASSWORD_RESETは最大1時間。消費は期限未満 |
| 照合情報 | emailKey・authVersionを保存。最新主体との一致は消費トランザクションで確認 |
| 復旧世代 | Member.restoreGenerationは0以上。復旧開始／中止等で増やす。RESTORE_CONFIRMだけ正数の世代を必須にし、古い世代を拒否する |
| 使用・失効 | usedAt／revokedAtを分離し、同時設定を拒否。使用日時は発行以降・期限未満。未使用・未失効を条件に更新する |
| MemberLifecycleEvent | 会員FK、任意退会／強制退会／復旧開始／完了／中止、理由、復旧世代、発生日時、必須の監査FK |
| 退会理由 | 任意退会・復旧中止は非空の理由が必須。強制退会理由は任意。復旧後もイベントを消さず再退会時は追加 |
| MemberReview | 申請会員、PENDING／DIFFERENT_PERSON／SAME_PERSON、管理者・判断根拠・判断時刻・監査・版 |
| MemberReviewMatch | 審査案件と一致候補の会員の関連。複数候補を保持し、同一候補の重複を禁止 |

未完了審査は会員ごとに1件とする部分一意索引`MemberReview_one_pending_key`をSQLで追加した。確定済み審査は保持し、訂正・再審査は新しい案件を作る。確定時は管理者FK・非空理由・日時・監査が必須。氏名検索用にMemberの姓キー・名キー・削除フラグの複合索引も追加した。

DBは復旧世代や認証版の**最新値との一致**、審査候補が別の退会会員であること、審査判断と会員状態更新の一体性までは保証しない。復旧の対象は過去にACTIVEへ到達した会員だけとし、Story 3.3／6.3で再検証する。Member.versionは会員情報の楽観的ロック、authVersionは認証失効、restoreGenerationは復旧要求の失効に使い分ける。

### 13.4 曜日別営業時間・休憩とTask 2.2.6への境界

| モデル | 内容 |
| --- | --- |
| BusinessSchedule | 1組の曜日別営業設定の内容をまとめるID・作成日時 |
| BusinessDay | `(scheduleId, weekday)`が主キー。営業／休業、開店時刻、必須の閉店時刻 |
| TherapistSchedule | 施術者FKと、1組の曜日別休憩の内容をまとめるID・作成日時 |
| TherapistBreak | `(scheduleId, weekday)`が主キー。開始・終了時刻、または両方NULLで未設定 |

weekdayは0＝日曜〜6＝土曜。時刻は`Time(0)`で店舗の壁時計時刻を保存する。PrismaではDateとして扱うため、後続の入出力では基準日を固定し、日時のUTC変換と混同しない。営業日は開店＜閉店かつ正時、休業日は開店NULL・閉店必須。休憩は正時からちょうど1時間で日をまたがず、片側だけNULLを拒否する。未設定曜日は割当対象外にする。

これらは設定の**内容を格納する単位**であり、現行設定ではない。Task 2.2.6で適用日・版・予定取消・変更履歴・日別上書きと関連付け、対象日から有効な内容を取得する。保存後に内容を上書きせず新しい内容IDを作る契約とする。7曜日が揃っていること、休憩が営業時間内であること、設定変更の適用日・既存予約への影響は複数行・対象日に依存するため、次のTaskとStory 3.2で検証する。

今回、通常seedへ曜日設定を追加していない。適用日なしの設定を誤って有効化せず、初期の曜日・休憩と適用日のseedはTask 2.2.6で追加する。DB検証では隔離スキーマに営業・休業・休憩・未設定の各例を作成した。

### 13.5 施術実績・取消・要調整

ReservationへactualStartedAt／actualCompletedAt／cancelledAt、cancellationKind／cancellationReason／cancellationAuditIdを追加した。実績は予定のstartsAt・treatmentEndsAt・occupiesUntilとは別に保存する。

| 予約状態 | 行単位で要求する情報 |
| --- | --- |
| CONFIRMED | 実績・取消情報はすべてNULL |
| IN_PROGRESS | actualStartedAt必須。完了・取消情報はNULL |
| COMPLETED | 開始・完了実績が必須、完了≧開始。取消情報はNULL |
| CANCELLED | 取消時刻・種別・監査FKが必須。開始・完了実績はNULL |

取消種別はNORMAL／STORE_EXCEPTION／MEMBER_WITHDRAWAL。店舗都合の例外は理由を必須にする。遅刻・超過は予定時刻を書き換えず、実績・状態との比較で扱う。状態遷移の認可と順序、取消時の枠削除、早期完了時の枠保持はStory 4.2／6.2で実装する。

`ReservationChangeNotice`は`(changeAuditId, reservationId)`を一意にし、変更元・予約の版、理由、変更候補、対応メモ・状態・終了時刻・更新版を保持する。未連絡、顧客待ち、対応中、影響解消後の店舗確認待ち、解決済みを区別し、解決済みだけresolvedAtを必須にする。予約の施術状態やメールの配信状態へ混ぜない。未解決の影響記録から要調整一覧を取得する。

変更元は設定変更・資源無効化のAuditLogで識別する。次のTaskで設定変更履歴と監査を関連付ける。新しい影響の抽出、解消しても店舗確認までは閉じない処理、送信直前の設定版・予約版再検証は後続サービスの責務。

### 13.6 送信要求・試行詳細・秘密の保持

`EmailDelivery`は消去しない最小限の送信記録。UUID requestKeyを一意にし、認証用途は`(tokenReferenceId, kind)`、予約変更案内は`(noticeId, kind)`でも重複を防ぐ。予約変更案内にはconfirmationAuditIdを必須にして、スタッフ／管理者の送信確認を記録する保存先を用意した。監査の操作者・actionが送信確認に対応するかはサービス側で検証する。

認証メールはtokenIdのFKと、削除後も残るtokenReferenceIdを分離した。AuthTokenを期限＋7日で削除するとtokenIdだけSET NULLになり、送信記録と重複防止キーは維持される。未処理の認証メールはtokenIdを必須とするため、期限切れ処理と秘密ペイロード消去を先に行う。異なる用途のトークンを送らないことや、有効なトークンを早期に削除しないことは送信・削除サービスで確認する。

| 保存する状態・情報 | 扱い |
| --- | --- |
| PENDING / SENDING / RETRY_WAIT | 未処理。宛先必須。認証メールは暗号化ペイロードも必須 |
| ACCEPTED | SMTP受付済み。acceptedAt・closedAtと1回以上の試行を必須とし、顧客対応完了とは区別 |
| FAILED / UNKNOWN / CANCELLED / EXPIRED | 自動送信対象外。UNKNOWNへnextAttemptAtを設定できない。closedAtは運用確認後に設定可能 |
| attemptCount | 0〜4。初回＋最大3回再試行。RETRY_WAITは1〜3回の時点だけ許可 |
| leaseId / leaseExpiresAt | SENDINGだけ必須。版・状態を条件に取得し、処理権を持つworkerだけが結果を保存する契約 |
| encryptedPayload / payloadKeyId / payloadExpiresAt | 3項目一体で保存・消去。再試行不要な状態には残さない。専用鍵の方式・暗号処理はStory 3.4で実装 |
| EmailDeliveryAttempt | deliveryId＋attemptNumberを一意化。処理権ID、開始／終了、結果、整形済みerrorCodeだけを保存 |

1・5・30分後の再試行時刻計算、期限時刻での停止、SMTP直前の主体・トークン・予約版確認、処理権の競合制御、結果不明時の運用はStory 3.4で実装する。今回のCHECKは任意の状態遷移をすべて禁止するものではない。

closedAt＋90日で配送宛先・試行詳細を消去しても、requestKey・対象参照・種別・受付／終了時刻・最終状態は残す。暗号化ペイロードはそれより早く、遅くとも有効期限までに消去・利用停止する。試行詳細の削除でEmailDelivery本体を消さず、通知の最小限の事実を維持する。

### 13.7 試行制限の保存先

`RateLimitBucket`の主キーはscope＋HMACの64桁hex keyDigest。scopeはメールアドレス／メール要求IP／ログイン主体／ログインIP／トークン確定IPを分ける。メール要求の用途横断制限は同じMAIL_ADDRESSキーを使い、LOGIN_ACCOUNTは主体種別を含めてHMAC化する。平文メール・IPの欄は作らない。

`RateLimitEvent`に試行時点を追加し、厳密な移動時間窓`(現在−窓幅, 現在]`で集計する。固定時間帯のカウンタだけにしない。Bucketの行ロックを共通の順序で取得し、制限確認・イベント追加・lastAttemptAt更新を同時確定する処理を後続で実装する。複数キーの上限、60秒間隔、全インスタンス共通制限はモデルだけでは完成しない。

最後の試行から24時間後にBucketを削除し、従属イベントだけCASCADEで削除できる。これは業務履歴とは異なる一時情報の保持方針である。

### 13.8 migration・検証結果

追加migrationは新規15テーブル・11enum、既存2テーブルの列追加、関連・検索索引、追加20 CHECK、審査の部分一意索引、監査の更新／削除拒否トリガーを含む。計26テーブル・14enum・69 CHECKとなる。

`Reservation_execution_check`は完了・取消の実績を必須にするため、前のSchemaで実績なしの完了／取消データを作っていた場合は、正しい実績と操作記録の移行が別途必要。今回のpublicには該当予約が0件であることを適用前に確認した。推測した日時で既存履歴を埋めていない。

| 確認 | 結果 |
| --- | --- |
| `prisma format` / `npm run check` | Schema検証・Client生成・lint・型チェック・既存23テスト成功 |
| `npm run test:db` | 隔離スキーマで153項目成功。全69 CHECKを制約名と照合して拒否ケース確認 |
| 権限・審査 | 権限0件が初期状態、重複権限・委譲キー・管理者以外の付与者を拒否。未完了審査の重複を拒否 |
| トークン | 主体・用途・世代・期限の制約確認。条件付き消費SQLの1回目は1行、2回目は0行 |
| 曜日設定 | 正時の営業／休業・1時間休憩・未設定を保存。曜日範囲外・逆転・半端時刻・片側NULL・曜日重複を拒否 |
| 施術・要調整 | 実績のない完了、終了時刻のない対応完了、同じ変更元・予約の影響重複を拒否 |
| 配信 | 要求重複・未確認の変更案内・不完全なペイロード・不正な試行回数や処理権を拒否。条件付き処理権取得は1回だけ成功 |
| 配信と保持 | 結果不明に自動再試行時刻を設定できない。トークン削除後も要求の一意性を保持。配信状態を変更しても顧客対応状態は維持 |
| 監査・試行制限 | 監査のUPDATE／DELETEを拒否。時間窓の下端を除外し、Bucket削除で試行イベントだけ削除 |
| 再作成・seed | 2つの空スキーマから列・制約・索引を再現。既存seedの件数・編集保持を維持 |
| publicへの追加適用 | 適用成功。既存11テーブルの件数と既存列の内容を適用前後の集約ハッシュで比較し一致 |
| 再適用・疎通 | `db:migrate`・`db:seed`・`db:check`成功 |
| 差分 | 手書きファイルと新規migration・検証コードの空白検査成功 |

ハンズオンは第12.5節と同じ`npm run check` → `npm run db:migrate` → `npm run db:seed` → `npm run db:check` → `npm run test:db`を使う。新しいDB検証は`scripts/lib/verify-operational-models.ts`に分離して既存コマンドへ組み込んだ。通常seedは変更せず、運用レコードを本番的な初期値として捏造しない。

トークン消費・処理権取得は検証用SQLの条件付き更新を確認したもので、認証・配信workerは未実装。実際の暗号化・SMTP通信、ブラウザ・本番環境・変更後のGitHub CI実行は未確認。今回build・依存監査は再実行していない。

### 13.9 完了判断と次のTask

Task 2.2.5の保存モデル・関連・制約・追加migrationとローカル検証を完了した。次はTask 2.2.6で、営業日・営業時間・休憩の適用日付き設定履歴と、有効な設定を取得するための関連・制約を完成させる。今回のBusinessSchedule／TherapistScheduleを内容の参照先として用い、日別上書き・予定訂正／取消・設定変更の監査・影響記録との関連を追加する。
