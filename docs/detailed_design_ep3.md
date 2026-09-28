# Epic 3 詳細設計：会員認証と店舗の予約受付条件

## 1. Task 3.1.1 の対象と前提

2026-09-28実施。READMEのEpic 3 >> Story 3.1 >> Task 3.1.1に対応する。既存の[認証設計](detailed_design.md#11-会員スタッフ管理者の認証と権限)・[パスワード設計](detailed_design.md#12-メール氏名照合パスワード確認トークン)と、[Epic 2の保存モデル](detailed_design_ep2.md)を実装へ接続する。

今回の対象は環境変数による管理者認証、StaffAccountによるスタッフ認証、ログイン・ログアウト、8時間の絶対期限とDB失効管理。店舗利用者向けの最小限の確認画面を用意する。Prisma Schema・migrationは変更しない。

操作別認可の全面適用はTask 3.1.2、認可を含む検証の拡充は3.1.3、スタッフ作成画面・権限付与／解除は3.1.4。会員登録・会員認証・メール再設定はStory 3.3／3.4で実装する。今回の店舗画面には予約更新等の業務操作を置かない。

## 2. 採用ライブラリと配置

| 項目 | 採用・理由 |
| --- | --- |
| NextAuth | `5.0.0-beta.32`を完全固定。npm registryのpeer dependenciesでNext.js 16／React 19が対応範囲であることを確認。安定版ではなくbetaである |
| パスワード | `@node-rs/argon2@2.2.1`を完全固定。Argon2id・version 19・19 MiB・反復2・並列度1・出力32バイト、ランダムソルト |
| 実行場所 | Node.js runtime。Prisma・ハッシュ・環境変数をserver-onlyの境界内で扱う。Edgeには配置しない |
| セッション | Credentials＋JWT。Prisma Adapterを入れず、既存AppSessionを失効・絶対期限の照合先に使う |

公式の[導入手順](https://authjs.dev/getting-started/installation)と、インストールされたAuth.jsのCredentials、JWT、session、signOut処理を確認した。Next.jsはローカルの`node_modules/next/dist/docs/01-app/`内の認証・Route Handler・Server Actionsガイドを読んで実装した。

| ファイル | 責務 |
| --- | --- |
| `src/auth.ts` | リクエストごとのNextAuth設定、provider、JWT／session callback、ログアウト連携、障害状態の集約、`getStoreSession` |
| `src/app/api/auth/[...nextauth]/route.ts` | GET／POST、Origin検証、429／503、失効失敗時のCookie保持 |
| `src/lib/auth/config.ts` | サーバー専用環境変数の検証 |
| `src/lib/auth/policy.ts` | メール・パスワード・JWT claim・戻り先の検証 |
| `src/lib/auth/password.ts` | Argon2idのハッシュ・照合・再ハッシュ判断 |
| `src/lib/auth/credentials.ts` | 資格情報の照合、主体再検証、AppSession発行 |
| `src/lib/auth/session.ts` | DBとの照合・失効 |
| `src/lib/auth/rate-limit.ts` | DB共有のログイン試行制限 |
| `src/components/auth/` | ログインフォーム・ログアウト・共通画面 |
| `src/app/admin/login/`、`src/app/staff/login/` | 主体別のログイン入口 |
| `src/app/manage/` | サーバーで認証した店舗利用者向けの確認画面 |
| `tests/auth-policy.test.ts` | 正規化、Unicode、無加工パスワード、戻り先の単体テスト |
| `scripts/verify-auth.ts` | 一時スキーマ＋専用Next.jsサーバーを使うHTTP統合検証 |

## 3. 資格情報とログイン

### 3.1 管理者

`ADMIN_EMAIL`・`ADMIN_PASSWORD`・`ADMIN_AUTH_VERSION`をサーバー環境変数から読む。メールは前後空白除去＋ASCII小文字化で照合する。パスワードは無加工の全体をSHA-256へ変換した同長バッファ同士を`timingSafeEqual`で比較する。これは比較用であり、管理者パスワードのDB保存には使わない。

既存seedの固定ID `00000000-0000-4000-8000-000000000001`をAdminAccountへ対応させる。有効なレコードが必要。ログイン時に管理者レコードを自動作成・再有効化しない。スタッフや会員のメールが一致しても管理者権限は得られない。

### 3.2 スタッフ

StaffAccount.emailKeyで検索し、passwordHashをArgon2で照合する。不存在でも同等のダミーハッシュを検証する。無効スタッフ・パスワード不一致・不存在は共通の認証失敗にする。

パスワードは15〜128 Unicodeコードポイント。空白除去・Unicode正規化・先頭切り捨てを行わない。ハッシュの設定が古ければ照合成功後に再ハッシュする。スタッフ作成自体はTask 3.1.4で実装するため、通常seedに固定パスワード付きスタッフを追加しない。統合テストだけが一時スキーマ内へランダムパスワードのスタッフを作成する。

### 3.3 発行処理

1. 同じブラウザの有効なセッションがあれば追加ログインを拒否し、先にログアウトを案内する。
2. 共有レート制限を消費する。成功・失敗の両方を数え、成功してもリセットしない。
3. 入力形式と資格情報を検証する。
4. DBトランザクションで該当主体行をロックし、有効状態・認証版を再確認する。スタッフはメール照合キーと元ハッシュも再確認する。
5. 必要な再ハッシュとAppSessionの作成を同時確定し、JWTを発行する。

同時リクエストによる別タブのログインまでは一意制約で直列化しない。Cookieは1つであり、通常の主体切替はログアウトしてから行う。発行後にHTTP応答が失敗して残ったAppSessionも8時間後には利用できなくなる。

## 4. セッションとログアウト

| 項目 | 実装 |
| --- | --- |
| JWT内 | sid、principalId、role、authVersion、absoluteExpiry。Auth.jsの標準iat／exp／jtiも付く。メール・氏名・パスワード・権限一覧を入れない |
| クライアントへ返すsession | user.id・user.roleとDB由来の絶対期限。sidを公開しない |
| 期限 | 管理者・スタッフとも作成から8時間。JWTのCookie更新でもAppSession.expiresAtは更新しない |
| 保護画面 | `getStoreSession()`で検証。未認証はスタッフログインへ案内。障害時は一時エラーを表示 |
| 照合内容 | AppSessionの存在、主体ID／種別、認証版、期限の完全一致、失効日時、最新の主体有効状態・認証版 |
| 失効 | ログアウトで現在のAppSession.revokedAtを保存。認証版変更・主体無効化は次の読込で拒否 |

期限ちょうど以降は拒否する。主体・セッション確認は共有キャッシュに保存しない。`jwt` callbackで更新要求のクライアント入力を採用しないため、role・期限等をsession updateで書き換えられない。

ログアウトはPOST＋CSRF検証後、Auth.jsのsignOut eventでDB失効してからCookieを削除する。採用版のAuth.jsはeventの例外を内部で捕捉してCookie削除を続行するため、リクエスト固有の失敗フラグを外側のRoute Handlerで確認する。DB失敗時はライブラリの応答を破棄し、Set-Cookieを付けず503を返す。画面も成功と表示せず再試行を案内する。セッション読込のDB障害も503とし、未認証の正常応答に混ぜない。

管理者の資格情報を変更するときはADMIN_AUTH_VERSIONを必ず増やし、全インスタンスを再起動／再デプロイする。スタッフの資格情報変更・無効化サービスは後続TaskでauthVersionの更新を含めて実装する。古いCookieを保存していても、失効記録や認証版が一致しなければ再利用できない。

## 5. 試行制限と入口の保護

ログイン前にRateLimitBucket／RateLimitEventを使い、主体種別＋正規化メールで直近15分5回、IPで30回まで許可する。HMAC-SHA256の専用鍵を使い、平文メール・IPを保存しない。アカウント不存在や形式不正でも制限を通す。

Bucketを一貫した順序で作成・行ロックし、DB時刻で`(現在−15分, 現在]`を数える。全キーが許可される場合だけイベントを追加する。超過はHTTP 429・Retry-After: 900。既存の時刻窓が失効すれば再試行でき、拒否要求は新しいイベントを追加しない。DBや設定が利用できない場合は503とし、制限を省略しない。

開発時は転送ヘッダーを信用せず、すべての接続を1つの開発用IP枠として扱う。本番はREADMEのVercel配置を前提に、`VERCEL=1`かつ有効な`x-vercel-forwarded-for`を要求する。[Vercelのヘッダー仕様](https://vercel.com/docs/headers/request-headers)を参照。IPv6は表記を正規化したアドレス全体をキーとし、/64集約は未実装。他のホスティングでは信頼できる入口の実装が必要であり、無条件にX-Forwarded-Forを採用しない。

認証POSTはAUTH_URLのoriginとOriginヘッダーの完全一致を要求し、加えてAuth.jsのCSRF検証を使う。戻り先は同一originの`/manage`・`/admin/login`・`/staff/login`だけに限定し、query／hashを引き継がない。本番はHTTPS必須でSecure Cookie、Auth.js既定のHttpOnly・SameSite=Laxを使う。localStorageへトークンを保存しない。

## 6. ハンズオン手順

### 6.1 ローカル設定

既存の`.env`／`.env.local`を上書きせず、`.env.example`の認証項目だけを追加する。`.env.local`が優先される。実値はGit・スクリーンショット・共有ログへ記載しない。

| 環境変数 | 設定 |
| --- | --- |
| AUTH_URL | ローカルは`http://localhost:3000`。ブラウザも同じhost／portを使う。本番は確定したHTTPS origin |
| AUTH_SECRET | 32バイト以上の独立した乱数から生成する秘密鍵 |
| AUTH_RATE_LIMIT_SECRET | AUTH_SECRETとは異なる独立した秘密鍵。全インスタンスで共有 |
| ADMIN_EMAIL | 管理者用メール |
| ADMIN_PASSWORD | 自分で決めた15〜128コードポイントのパスワード |
| ADMIN_AUTH_VERSION | 初回1。資格情報変更時に増加 |

秘密鍵はパスワード管理ツール等で生成・管理する。空欄のままでもビルドは可能だが、ログインは設定不足として利用不可になる。今回、利用者の実際の`.env`や資格情報は変更していない。

```sh
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run check
npm run test:auth
npm run dev
```

1. `/admin/login`を開き、設定した管理者資格情報でログインする。
2. `/manage`に管理者としての状態と期限が表示される。
3. ログアウト後に`/manage`を再表示し、ログインへ戻ることを確認する。
4. 別の主体を使う場合はログアウトしてから`/staff/login`を使う。永続スタッフの作成・権限設定UIはTask 3.1.4で追加する。現時点のスタッフ経路は`test:auth`が一時データで検証する。

開発用IP枠は全ブラウザで共有する。短時間に繰り返して429になった場合は15分待つ。無理に制限テーブルを消して本番仕様を回避しない。

### 6.2 統合検証の分離

`test:auth`は既存のローカルDB限定ガードを通し、ランダム名の一時スキーマに全migrationを適用する。専用ポート・ビルドディレクトリのNext.js devサーバーを起動し、HTTPでCSRF・Cookie・Credentials callback・session・signoutを確認する。テスト終了時にサーバーを終了し、一時スキーマと生成物を削除する。publicの会員・スタッフ・セッション・試行履歴は変更しない。

`getPrisma`では接続URLのschemaをPrismaPgへ渡すようにした。通常のpublic接続は従来どおり。一時スキーマのHTTP検証でも実際のアプリのDB処理を利用する。

## 7. 検証結果と残る範囲

| 検証 | 結果 |
| --- | --- |
| `npm run check` | Prisma検証・生成、lint、型チェック、29テスト成功 |
| `npm run test:auth` | 一時スキーマと実際のNext.js HTTPハンドラで成功。管理者／スタッフログイン、誤資格情報、主体混同拒否、初期権限0件、CSRF欠落・外部Origin拒否を確認 |
| セッション | 最小限の公開情報、期限直前／ちょうど、ログアウト後の旧Cookie拒否、スタッフ認証版変更・無効化後の拒否を確認。管理者認証版の変更は共通照合関数で検証 |
| 試行制限 | 同じメールへの6並行試行で5件のみ許可。次のHTTPログインは429、15分窓の経過後は制限解除 |
| 障害 | 一時スキーマのAppSessionテーブルを一時的に退避し、sessionとsignoutの503、Cookie削除なし、DB復旧後のログアウト成功を確認 |
| `npm run build -- --webpack` | 本番ビルド成功。管理者／スタッフログイン・店舗画面・認証APIが動的ルートとして生成 |
| 依存追加 | npm install時の監査で脆弱性0件 |

Turbopackの通常buildは実行環境のポートbind制限で停止したため、Webpackで確認した。ブラウザでの入力・遷移の目視確認、本番Vercel／Neon、Secure Cookieの実通信、GitHub CIは未検証。通常の`.env`は変更していない。

統合検証で見つかった初回Bucket作成の競合は、空のupdateを使わずDBの原子的なupsertへ修正して再検証した。生SQLのロックもORMと同じschemaを参照するよう、トランザクション内のsearch_pathをパラメータ化して設定する。テスト用生成物はGit・lint・通常の型チェックから除外する。

Task 3.1.1を完了とし、次はTask 3.1.2で業務処理へ共通の権限チェックを組み込む。

後続の対応範囲：操作別権限チェック・スタッフ管理UI、会員認証、メール再設定、失効セッションと試行履歴の保持期間に沿った定期削除、業務更新と権限解除の共通ロック、Vercel本番でのネイティブArgon2配置と信頼IP・Cookieの検証。ローカルでの機能検証と本番環境での動作確認は区別する。
