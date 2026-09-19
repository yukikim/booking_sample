# 詳細設計：Epic 2 開発環境とデータ基盤

更新日：2026-09-19

状態：Task 2.1.1〜2.1.4・2.2.1完了。基本モデルの定義・検証結果は第9章。DBへの適用は未実施。次はTask 2.2.2。ブラウザ目視・修正後のGitHub CI再実行は未確認。

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
