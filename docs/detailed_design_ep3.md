# Epic 3 詳細設計：会員認証と店舗の予約受付条件

## 1. Task 3.1.1 の対象と前提

2026-09-28実施。READMEのEpic 3 >> Story 3.1 >> Task 3.1.1に対応する。既存の[認証設計](detailed_design.md#11-会員スタッフ管理者の認証と権限)・[パスワード設計](detailed_design.md#12-メール氏名照合パスワード確認トークン)と、[Epic 2の保存モデル](detailed_design_ep2.md)を実装へ接続する。

今回の対象は環境変数による管理者認証、StaffAccountによるスタッフ認証、ログイン・ログアウト、8時間の絶対期限とDB失効管理。店舗利用者向けの最小限の確認画面を用意する。Prisma Schema・migrationは変更しない。

本節の実装後、操作別認可の共通ガードと既存管理入口への適用をTask 3.1.2（第8章）で追加した。認可を含む検証の拡充は3.1.3、スタッフ作成画面・権限付与／解除は3.1.4。会員登録・会員認証・メール再設定はStory 3.3／3.4で実装する。予約更新等の業務操作はまだ存在しない。

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
4. 別の主体を使う場合はログアウトしてから`/staff/login`を使う。スタッフの作成・権限設定は第10章を参照する。

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

Task 3.1.1を完了した。続くTask 3.1.2は第8章に記録する。

後続の対応範囲：予約・マスタ更新入口への操作別権限チェック、スタッフ管理UI、会員認証、メール再設定、失効セッションと試行履歴の保持期間に沿った定期削除、業務更新と権限解除の共通ロック、Vercel本番でのネイティブArgon2配置と信頼IP・Cookieの検証。ローカルでの機能検証と本番環境での動作確認は区別する。

## 8. Task 3.1.2：管理画面とサーバー側認可

2026-09-28実施。Task 3.1.1の認証セッションを前提に、店舗側の各入口で利用できる認可処理を実装した。DBスキーマや既存migrationは変更していない。

### 8.1 権限の定義と判定

`src/lib/auth/permissions.ts`の`requireStoreAction(action)`を共通ガードとする。`STORE_VIEW`は有効な管理者・スタッフに許可する。`STAFF_PERMISSION_MANAGE`は管理者だけの操作であり、StaffPermissionKeyに存在させない。その他の26操作は既存のStaffPermissionKeyと一致させる。未知の操作名は拒否する。管理者は全操作に対して許可、スタッフは対象キーのStaffPermission行が現在存在するときだけ許可する。権限一覧をJWTや共有キャッシュへ複写しない。

判定順序は、NextAuth JWT → AppSessionの失効・絶対期限・主体の最新状態 → 操作キーの検証 → 操作別のStaffPermission確認。未認証・失効は401、権限不足は403、DBや認証設定の障害は503として区別する。画面表示のための`getStoreCapabilities()`は、毎回DBから最新の権限行を取得する。表示用の権限情報だけで更新を許可してはいけない。更新API・Server Actionはそれぞれサーバーが選んだ固定の操作キーで`requireStoreAction`を呼ぶ。

| 対象 | 実装した入口と権限 |
| --- | --- |
| `/manage` | `getStoreCapabilities()`から`STORE_VIEW`を確認。管理者とスタッフに表示し、スタッフの更新権限件数を最新状態で示す |
| `/manage/staff` | `getStaffRoster()`が`STAFF_PERMISSION_MANAGE`を確認。管理者にだけスタッフ名・メール・有効状態を表示 |
| `GET /api/manage/staff` | 同じ`getStaffRoster()`を呼ぶ。未認証401、スタッフ403、障害503。正常時も`Cache-Control: no-store` |

認証用の`/api/auth/[...nextauth]`はログイン前にも利用する入口なので、店舗の操作権限は要求しない。`src/lib/schedules/effective.ts`は内部の対象日設定取得関数であり、将来の公開空き検索からも利用する。呼び出すRoute Handler・Server Actionで用途に応じて認可する。

スタッフ一覧は新しい登録から最大50件の読み取りだけ。スタッフ作成、権限付与・解除、保存APIはTask 3.1.4で実装する。予約・マスタの更新APIはまだ存在せず、各Storyで実装するときに操作キー・業務条件・監査を組み合わせる。更新と権限解除が同時に走る場合の確定順を保証する共通ロックは、更新サービスと権限変更サービスの両方で導入する。現段階の読み取りガードだけで更新競合を解決したとは扱わない。

### 8.2 ハンズオンと検証

`.env.example`に従ってローカルの管理者資格情報を設定し、`npm run dev`で`/admin/login`へログインする。`/manage`にスタッフ一覧へのリンクが現れ、`/manage/staff`で一覧を閲覧できる。スタッフは`/staff/login`から入り、`/manage`では初期状態の「閲覧のみ」を確認できる。スタッフが一覧URLへ直接アクセスしても内容は表示されず、APIも403を返す。

`npm run check`でlint・型チェック・29件のテストに成功。`npm run test:auth`の一時スキーマ／実HTTP検証に、未ログインの管理API401、管理者の一覧200、スタッフの403と画面での非表示を追加した。同じスタッフセッションのままRESERVATION_CANCEL行を追加・削除すると、店舗画面の権限件数が1件・0件へ変化することを確認した。権限行を持っていても管理者専用一覧は403のままである。

この検証はローカルの一時DBとNext.jsサーバーで行った。実際のブラウザ目視、本番環境、後続の予約更新・権限解除との同時実行は未検証。未認証・権限不足・期限切れの画面／API応答は、続くTask 3.1.3として第9章で確認する。

## 9. Task 3.1.3：未認証・権限不足・期限切れの検証

2026-09-28実施。`scripts/verify-auth.ts`の一時PostgreSQLスキーマと専用Next.jsサーバーを使い、実際のHTTP応答とDB状態を照合した。publicの会員・スタッフ・セッションを変更しない。Task 3.1.2で設けた店舗画面、管理者専用画面・APIを対象にした。

| 状態 | `/manage` | `/manage/staff` | `GET /api/manage/staff` |
| --- | --- | --- | --- |
| 未ログイン | 307で`/staff/login`へ | 307で`/admin/login`へ | 401。スタッフ情報なし |
| 有効な管理者 | 店舗画面を表示 | スタッフ一覧を表示 | 200。一覧は管理者だけに返す |
| 有効な初期スタッフ | 閲覧のみを表示 | 権限不足の案内を表示し、一覧のメールを含めない | 403。スタッフ情報なし |
| 期限切れの署名付きCookie | 307で`/staff/login`へ | 307で`/admin/login`へ | 401。スタッフ情報なし |

期限切れケースは、テスト専用の管理者AppSessionを過去の時刻で作成し、同じ絶対期限を持つ正しく署名されたJWT Cookieを送った。Auth.jsの`/api/auth/session`も`null`を返す。これによりCookieが存在するだけでは保護画面を開けないことを確認した。`resolveSession`単体では期限直前に有効、期限ちょうどに無効となる境界を確認した。Auth.jsのsession取得でJWT Cookieが更新されても、JWT内の絶対期限は元の値のままだった。

追加で、ログアウト後の旧Cookie、スタッフのauthVersion変更後、スタッフ無効化後は管理APIが401となることを確認した。同じスタッフに通常の`RESERVATION_CANCEL`権限行を追加しても、管理者専用一覧は403のまま。権限行を削除すると、ログイン中の店舗画面は閲覧のみへ戻る。AppSessionのDB読込障害では管理API・認証sessionとも503となり、未認証や権限不足として誤分類していない。

権限不足のページは拒否案内を本文に返し、HTTPステータスは現実装では200。APIは403を返す。ページには対象スタッフのメールを含めない。将来の予約取消などの更新APIはまだ存在しないため、その入口の403と、権限解除と更新の同時実行は各機能の実装時に検証する。実ブラウザの表示・操作、本番Cookie・Vercel／Neonでの動作確認も今回の検証には含まれない。

`npm run test:auth`で上記のHTTP・DB検証が成功。`npm run check`でPrisma検証、lint、型チェック、既存29テストを確認した。Task 3.1.3を完了とし、次はTask 3.1.4でスタッフ作成と権限付与・解除の保存入口を実装する。

## 10. Task 3.1.4：スタッフ作成と権限付与・解除

2026-09-28実施。管理者は`/manage/staff`からスタッフを選択し、`/manage/staff/[id]`の26項目のチェックで権限を1件ずつ付与・解除する。チェック変更は即時保存し、成功した項目だけ画面に反映する。スタッフ作成フォームは管理者一覧と`/manage/staff/new`に設けた。`STAFF_CREATE`を持つスタッフも後者から作成できるが、権限設定画面とスタッフ一覧には入れない。

### 10.1 保存契約と初期状態

| 入口 | 許可主体 | 保存内容 |
| --- | --- | --- |
| `POST /api/manage/staff` | 管理者、または現在`STAFF_CREATE`を持つスタッフ | 表示名、正規化したASCIIメール、Argon2idハッシュを持つ有効なStaffAccountを作成。StaffPermissionは作成しない |
| `POST /api/manage/staff/[id]/permissions` | 管理者のみ | 既存のStaffPermissionKeyを1件指定して付与・解除。付与時の`grantedByAdminId`を記録する。権限管理そのものを表すキーは存在しない |

パスワードは15〜128コードポイント、表示名は空白を除いた1〜100文字、メールは既存認証と同じ照合規則を用いる。入力に余計なフィールドがあれば拒否し、クライアントからロール・権限一覧・監査主体を受け取らない。重複メールは409、入力不正は400、未認証は401、権限不足と異なるOriginは403、対象なしは404、障害は503。応答にハッシュを含めず、保存APIの応答は`no-store`とする。同じ権限状態への再送は変更なしとして成功し、監査行も増やさない。

作成と権限変更はそれぞれ一つのDBトランザクションで処理し、`AuditLog`へ`STAFF_CREATED`、`STAFF_PERMISSION_GRANTED`、`STAFF_PERMISSION_REVOKED`を記録する。作成の監査には初期権限件数のみ、権限変更の監査にはキーのみを含め、パスワードやハッシュを記録しない。保存失敗時は本体と監査をともにロールバックする。

### 10.2 ログイン中の権限変更

更新リクエストでは署名付きCookieから主体を取り、AppSession行と主体のAccount行をトランザクション内でロックした後、失効・期限・認証版・有効状態を再確認する。スタッフ作成は同じトランザクション内で`STAFF_CREATE`行を再照合する。管理者の権限変更は対象スタッフのAccount行をロックしてから権限行を変更する。したがって、そのスタッフの作成処理と権限解除が同時に走ると、先にAccountロックを確保した処理が先に確定する。解除が先なら作成を403で拒否し、作成が先ならその作成だけを完了させる。既存セッションのJWTへ権限を複写しないため、ログアウトを待たずに次の操作から解除が効く。

### 10.3 ハンズオンと検証

管理者でログインし、`/manage/staff`でスタッフを作成する。新規スタッフの権限画面はすべて未チェック。対象スタッフでログインすると`/manage`は「閲覧のみ」を表示する。管理者が`STAFF_CREATE`をチェックすると、そのスタッフに作成リンクが現れる。スタッフが別のスタッフを作成しても新規アカウントの権限は0件で、スタッフが権限設定APIを呼んでも403。管理者が`STAFF_CREATE`を解除すると、同じスタッフセッションからの次の作成要求は403となる。

`npm run check`でPrisma検証・生成、lint、型チェック、29件のテストを確認。`npm run test:auth`は隔離した一時スキーマと実HTTPで、管理者による付与・解除、重複付与時の監査1件、スタッフによる作成と権限委譲の拒否、作成されたスタッフの権限0件・閲覧のみ、既存セッションからの作成拒否、外部Origin拒否を確認する。`npm run build -- --webpack`でも新規画面とAPIの本番ビルドを確認する。実ブラウザでの操作と本番Vercel／Neonでの検証は未実施。予約・マスタなど後続の更新入口は、ここで使ったAccount行ロックと権限再照合を各保存トランザクションへ組み込む。

## 11. Task 3.2.1：施術メニュー・オプションの管理

2026-09-28実施。`/manage/catalog`に施術メニューとオプションの一覧・追加フォーム・編集・無効化を設けた。閲覧は有効な店舗セッションで可能。管理者は全操作、スタッフは`TREATMENT_CREATE`／`TREATMENT_UPDATE`／`TREATMENT_DISABLE`、`OPTION_CREATE`／`OPTION_UPDATE`／`OPTION_DISABLE`のうち現在付与されている操作だけを実行できる。画面上のボタン表示は案内に過ぎず、保存APIが固定の操作キーで再認可する。無効化は`isActive=false`とし、物理削除や予約時点のSnapshot更新は行わない。メニュー・オプションの変更は今回即時反映であり、第8章の適用日付き営業設定とは別の対象とする。

### 11.1 入力とHTTP契約

| 入口 | 操作 | 成功応答 |
| --- | --- | --- |
| `GET /api/manage/catalog/treatments`、`/options` | 有効／無効を含む一覧。店舗セッションが必要 | `items`、200 |
| `POST /api/manage/catalog/treatments`、`/options` | 名称・時間・税込料金を追加 | 作成項目、201 |
| `PATCH /api/manage/catalog/treatments/[id]`、`/options/[id]` | `operation=update`で編集、`operation=disable`で無効化 | 更新項目、200 |

名称は前後空白を除き、1〜100 Unicodeコードポイントで制御文字を拒否する。時間・料金はフォーム文字列なら前後空白除去後に半角数字だけを受け、JSON数値なら安全な整数だけを受ける。メニュー時間は1〜1,380分、オプション追加時間は0〜1,380分、各料金は税込0〜1,000,000円。空欄、負数、小数、カンマ、指数表記の文字列は400で拒否する。未知のフィールドや対象IDも受け付けない。DBの既存CHECK制約も同じ数値範囲を強制する。予約全体の合計時間・料金はEpic 4の予約保存時に別途検証する。

編集と無効化は画面が読んだ`updatedAt`を要求し、DB行の更新日時と一致しない場合は409とする。トランザクション内でAppSession・操作主体・対象マスタ行をロックして再照合するため、操作権限の解除と保存、および同じ項目への並行更新の確定順が決まる。変更後の`updatedAt`は直前より必ず進める。同値への編集は保存・監査を増やさない。無効項目の再編集や再無効化は409で拒否する。未認証401、権限不足・異なるOrigin403、入力不正400、対象なし404、競合409、障害503。API応答は`Cache-Control: no-store`。

保存と同じトランザクションで`AuditLog`に作成・編集・無効化を記録し、対象ID、操作主体、変更前後の名称・時間・税込料金・有効状態を追跡する。監査保存に失敗すればマスタ更新もロールバックする。旧予約の参照はRestrictとSnapshotで保持し、新規予約が無効な項目を選べない判定は予約機能の実装時に組み込む。

### 11.2 ハンズオンと検証

管理者で`/manage`から「施術メニュー・オプション」へ進み、各項目を追加・編集・無効化する。0分・0円のオプションは有効な入力。無効化した行は一覧に残る。スタッフには管理者が操作別の権限を付与し、許可されたボタンと保存だけが利用できることを確認する。2つの画面で同じ項目を開いて先に片方を保存した場合、後の保存は409となり再読み込みを促す。

`npm run test:auth`の隔離スキーマ・実HTTP検証では、メニュー／オプションの追加・編集・無効化、時間と料金の境界、0分オプション、不正な数値表現、外部Origin拒否、スタッフの操作別403、既存セッションへの権限解除反映、旧更新日時の409、監査行を確認した。`npm run check`でPrisma検証・生成、lint、型チェックと既存単体テストを確認し、`npm run build -- --webpack`で本番ビルドを確認した。ブラウザでの手操作、本番環境、予約作成時のマスタ照合は未検証・後続Taskの範囲とする。
