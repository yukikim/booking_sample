import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadDevelopmentDatabase, runPrisma } from "./lib/development-database";
import { ADMIN_ID } from "../src/lib/auth/policy";

async function main() {
  const connectionString = loadDevelopmentDatabase();
  const schema = `member_verify_${randomUUID().replaceAll("-", "")}`;
  const pg = new Client({ connectionString }); await pg.connect();
  const distDir = `.next-member-test-${schema}`;
  let db: PrismaClient | undefined;
  let server: ChildProcess | undefined;
  try {
    await pg.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString); url.searchParams.set("schema", schema);
    runPrisma(["migrate", "deploy"], url.href);
    process.env.DATABASE_URL = url.href;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }), log: [] });
    (globalThis as unknown as { bookingPrisma: PrismaClient }).bookingPrisma = db;
    const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
    const port = (portProbe.address() as {port:number}).port;
    await new Promise<void>((done) => portProbe.close(() => done()));
    const origin = `http://127.0.0.1:${port}`;
    process.env.AUTH_URL = origin;
    process.env.AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString("hex");
    process.env.MAIL_PAYLOAD_KEY = randomBytes(32).toString("base64");
    process.env.ADMIN_EMAIL = "admin@example.test";
    process.env.ADMIN_PASSWORD = randomBytes(24).toString("base64url");
    process.env.ADMIN_AUTH_VERSION = "1";
    await db.adminAccount.create({ data: { id: ADMIN_ID, displayName: "Test administrator" } });
    mkdirSync(distDir);
    const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    tsconfig.include = [resolve("src/**/*.ts"), resolve("src/**/*.tsx"), resolve("next-env.d.ts")];
    tsconfig.compilerOptions.baseUrl = process.cwd();
    tsconfig.compilerOptions.paths = { "@/*": ["./src/*"] };
    writeFileSync(`${distDir}/tsconfig.json`, JSON.stringify(tsconfig));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"], { env: { ...process.env, NODE_OPTIONS: "", NEXT_DIST_DIR: distDir, AUTH_TEST_TSCONFIG: `${distDir}/tsconfig.json` }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; server.stdout?.on("data", (part) => { output = (output + String(part)).slice(-8000); }); server.stderr?.on("data", (part) => { output = (output + String(part)).slice(-8000); });
    let ready = false;
    for (let i=0;i<90;i++) { try { if ((await fetch(`${origin}/api/auth/csrf`)).ok) { ready=true; break; } } catch {} if (server.exitCode !== null) break; await new Promise((done) => setTimeout(done,500)); }
    if (!ready) process.stderr.write(output.replaceAll(process.env.ADMIN_PASSWORD, "[redacted]"));
    assert(ready, "Test server did not become ready");
    const { decryptMailPayload } = await import("../src/lib/member/mail");
    const { resolveSession } = await import("../src/lib/auth/session");
    const { getToken, encode } = await import("next-auth/jwt");
    const jar = new Map<string,string>();
    const cookie = () => [...jar].map(([k,v])=>`${k}=${v}`).join("; ");
    async function auth(path: string, body?: Record<string,string>, customCookie = cookie()) {
      const response = await fetch(`${origin}/api/auth/${path}`, { method: body ? "POST" : "GET", headers: { cookie: customCookie, origin, ...(body ? { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1" } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
      for (const raw of response.headers.getSetCookie()) { const [key, ...rest] = raw.split(";")[0].split("="); const value = rest.join("="); if (value) jar.set(key,value); else jar.delete(key); }
      return response;
    }
    async function login(email: string, password: string) { const csrf = await (await auth("csrf")).json(); return auth("callback/member", { email, password, csrfToken: csrf.csrfToken, callbackUrl: "/account" }); }
    async function post(path: string, body: object) { return fetch(`${origin}/api/member/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
    async function tokenFor(emailKey: string) { const delivery = await db!.emailDelivery.findFirstOrThrow({ where: { recipient: emailKey, encryptedPayload: { not: null } }, orderBy: { createdAt: "desc" } }); const text = decryptMailPayload(delivery.encryptedPayload!).text; return text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1] ?? ""; }
    const password = "temporary-password-123456";
    const freshPassword = "confirmed-password-123456";
    const details = { email: "first@example.test", lastName: "山田", firstName: "花子", phoneNumber: "09012345678", postalCode: "123-4567", ageBand: 30, password };
    const firstRegistration = await post("register", details);
    assert.equal(firstRegistration.status, 200, `${await firstRegistration.text()}\n${output}`);
    assert.equal((await post("register", { ...details, lastName: "別人" })).status, 200);
    assert.equal(await db.member.count({ where: { emailKey: details.email } }), 1);
    let member = await db.member.findUniqueOrThrow({ where: { emailKey: details.email } });
    assert.equal(member.status, "PENDING_EMAIL");
    assert.equal(member.lastName, "山田");
    assert.match((await (await login(details.email,password)).json()).url, /CredentialsSignin/);
    const firstToken = await tokenFor(details.email);
    assert(firstToken);
    await db.rateLimitBucket.updateMany({ where: { scope: "MAIL_ADDRESS" }, data: { lastAttemptAt: new Date(0) } });
    assert.equal((await post("resend", { email: details.email })).status, 200);
    const confirmation = await tokenFor(details.email);
    assert.notEqual(confirmation, firstToken);
    assert.equal((await post("confirm", { token: firstToken, password: freshPassword })).status, 409);
    assert.equal((await post("confirm", { token: confirmation, password: freshPassword })).status, 200);
    assert.equal((await post("confirm", { token: confirmation, password: freshPassword })).status, 409);
    member = await db.member.findUniqueOrThrow({ where: { emailKey: details.email } });
    assert.equal(member.status, "ACTIVE");
    assert(member.emailVerifiedAt);
    assert.match((await (await login(details.email,password)).json()).url, /CredentialsSignin/);
    assert.equal((await login(details.email,freshPassword)).status, 200);
    const memberCookie = cookie();
    const session = await (await auth("session")).json();
    assert.equal(session.user.role, "MEMBER");
    assert.equal(session.user.id, member.id);
    assert.equal((await fetch(`${origin}/api/manage/staff`, { headers: { cookie: memberCookie } })).status, 403);
    assert.equal((await fetch(`${origin}/api/manage/staff/${member.id}/permissions`, { method: "POST", headers: { cookie: memberCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ permission: "ROOM_CREATE", enabled: true }) })).status, 403);
    assert.match(await (await fetch(`${origin}/account`, { headers: { cookie: memberCookie } })).text(), /会員ページ/);
    assert.equal((await fetch(`${origin}/manage`, { headers: { cookie: memberCookie }, redirect: "manual" })).status, 200);
    assert.match(await (await fetch(`${origin}/manage`, { headers: { cookie: memberCookie } })).text(), /権限がありません/);
    const jwt = await getToken({ req: new Request(origin, { headers: { cookie: memberCookie } }), secret: process.env.AUTH_SECRET, secureCookie: false });
    assert(jwt);
    assert.equal(await resolveSession(jwt, new Date(Number(jwt.absoluteExpiry))), null);
    const expiredJwt = await encode({ token: { ...jwt, absoluteExpiry: Date.now()-1000 }, secret: process.env.AUTH_SECRET, salt: "authjs.session-token", maxAge: 7*24*60*60 });
    assert.equal(await (await auth("session", undefined, `authjs.session-token=${expiredJwt}`)).json(), null);
    await db.rateLimitBucket.updateMany({ where: { scope: "MAIL_ADDRESS" }, data: { lastAttemptAt: new Date(0) } });
    assert.equal((await post("reset-request", { email: details.email })).status, 200);
    assert.equal((await post("reset-request", { email: "unknown@example.test" })).status, 200);
    const reset = await tokenFor(details.email);
    await db.authToken.update({ where: { digest: (await import("../src/lib/member/mail")).tokenDigest(reset) }, data: { createdAt: new Date(Date.now()-30*60_000), expiresAt: new Date(Date.now()-1000) } });
    assert.equal((await post("reset", { token: reset, password: "reset-password-123456" })).status, 409);
    const expired = await db.authToken.findUniqueOrThrow({ where: { digest: (await import("../src/lib/member/mail")).tokenDigest(reset) } });
    assert.equal(expired.usedAt, null);
    // Use a distinct address to avoid the 60-second shared email throttle.
    const second = { ...details, email: "second@example.test", firstName: "太郎" };
    assert.equal((await post("register", second)).status, 200);
    const secondToken = await tokenFor(second.email);
    assert.equal((await post("confirm", { token: secondToken, password: freshPassword })).status, 200);
    await db.member.update({ where: { emailKey: second.email }, data: { status: "WITHDRAWN", isDeleted: true } });
    const review = { ...details, email: "review@example.test", firstName: "太郎" };
    assert.equal((await post("register", review)).status, 200);
    assert.equal((await post("confirm", { token: await tokenFor(review.email), password: freshPassword })).status, 200);
    assert.equal((await db.member.findUniqueOrThrow({ where: { emailKey: review.email } })).status, "PENDING_REVIEW");
    assert.equal(await db.memberReview.count({ where: { member: { emailKey: review.email } } }), 1);
    assert.match((await (await login(review.email, freshPassword)).json()).url, /CredentialsSignin/);
    await db.member.update({ where: { id: member.id }, data: { status: "WITHDRAWN", isDeleted: true } });
    assert.equal(await (await auth("session", undefined, memberCookie)).json(), null);
    assert.doesNotMatch(await (await fetch(`${origin}/account`, { headers: { cookie: memberCookie } })).text(), /ログイン中です/);
    assert.equal((await post("register", details)).status, 200);
    assert.equal(await db.member.count({ where: { emailKey: details.email } }), 1);
    // Fresh active account: successful reset invalidates its live session.
    await db.member.update({ where: { id: member.id }, data: { status: "ACTIVE", isDeleted: false } });
    await db.rateLimitBucket.deleteMany();
    assert.equal((await post("reset-request", { email: details.email })).status, 200);
    const reset2 = await tokenFor(details.email);
    assert.equal((await post("reset", { token: reset2, password: "reset-password-123456" })).status, 200);
    assert.equal(await (await auth("session", undefined, memberCookie)).json(), null);
    assert.equal((await post("reset", { token: reset2, password: "reset-password-123456" })).status, 409);
    assert.equal((await login(details.email, "reset-password-123456")).status, 200);
    const csrf = await (await auth("csrf")).json();
    assert.equal((await auth("signout", { csrfToken: csrf.csrfToken, callbackUrl: "/login" })).status, 200);
    assert.equal(await (await auth("session")).json(), null);
    assert.equal((await post("register", { ...details, ageBand: 10 })).status, 400);
    process.stdout.write("Member registration, review, auth boundaries, expiry, reset and logout passed.\n");
  } finally {
    if (server) { server.kill("SIGTERM"); await once(server,"exit").catch(()=>{}); }
    await db?.$disconnect();
    if (distDir) rmSync(distDir, { recursive:true, force:true });
    await pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pg.end();
  }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode=1; });
