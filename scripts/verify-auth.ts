import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadDevelopmentDatabase, runPrisma } from "./lib/development-database";
import { hashPassword } from "../src/lib/auth/password";
import { ADMIN_ID } from "../src/lib/auth/policy";

async function main() {
  const connectionString = loadDevelopmentDatabase();
  const schema = `auth_verify_${randomUUID().replaceAll("-", "")}`;
  const pg = new Client({ connectionString });
  await pg.connect();
  const distDir = `.next-auth-test-${schema}`;
  let prisma: PrismaClient | undefined;
  let server: ChildProcess | undefined;
  try {
    await pg.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString); url.searchParams.set("schema", schema);
    runPrisma(["migrate", "deploy"], url.href);
    process.env.DATABASE_URL = url.href;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }), log: [] });
    (globalThis as unknown as { bookingPrisma: PrismaClient }).bookingPrisma = prisma;
    const portProbe = createServer();
    portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
    const port = (portProbe.address() as { port: number }).port;
    await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    process.env.AUTH_URL = origin;
    process.env.AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.AUTH_RATE_LIMIT_SECRET = randomBytes(32).toString("hex");
    process.env.ADMIN_EMAIL = "admin@example.test";
    process.env.ADMIN_PASSWORD = randomBytes(24).toString("base64url");
    process.env.ADMIN_AUTH_VERSION = "1";
    await prisma.adminAccount.create({ data: { id: ADMIN_ID, displayName: "Test administrator" } });
    const password = randomBytes(24).toString("base64url");
    const staff = await prisma.staffAccount.create({ data: { email: "staff@example.test", emailKey: "staff@example.test", displayName: "Test staff", passwordHash: await hashPassword(password) } });
    mkdirSync(distDir);
    const testTsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    testTsconfig.include = [resolve("src/**/*.ts"), resolve("src/**/*.tsx"), resolve("next-env.d.ts")];
    testTsconfig.compilerOptions.baseUrl = process.cwd();
    testTsconfig.compilerOptions.paths = { "@/*": ["./src/*"] };
    writeFileSync(`${distDir}/tsconfig.json`, JSON.stringify(testTsconfig));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"], {
      env: { ...process.env, NODE_OPTIONS: "", DATABASE_URL: url.href, DIRECT_URL: url.href, NEXT_DIST_DIR: distDir, AUTH_TEST_TSCONFIG: `${distDir}/tsconfig.json` }, stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOutput = "";
    server.stdout?.on("data", chunk => { serverOutput = (serverOutput + String(chunk)).slice(-8000); });
    server.stderr?.on("data", chunk => { serverOutput = (serverOutput + String(chunk)).slice(-8000); });
    let ready = false;
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(`${origin}/api/auth/csrf`)).ok) { ready = true; break; } } catch {}
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) console.error(serverOutput.replaceAll(process.env.ADMIN_PASSWORD!, "[redacted]").split("\n").filter(line => !line.includes("GET /api/auth/")).join("\n"));
    assert(ready, "Test server did not become ready.");
    const { resolveSession } = await import("../src/lib/auth/session");
    const { consumeLoginAttempt, LoginRateLimited } = await import("../src/lib/auth/rate-limit");
    const { getToken } = await import("next-auth/jwt");
    const jar = new Map<string, string>();
    const cookie = () => [...jar].map(([k,v]) => `${k}=${v}`).join("; ");
    async function call(path: string, body?: Record<string,string>, customOrigin = origin, customCookie = cookie()) {
      const response = await fetch(`${origin}/api/auth/${path}`, { method: body ? "POST" : "GET", headers: { cookie: customCookie, origin: customOrigin, ...(body ? { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1" } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
      for (const raw of response.headers.getSetCookie()) {
        const [name, ...parts] = raw.split(";")[0].split("=");
        const value = parts.join("=");
        if (value) jar.set(name, value); else jar.delete(name);
      }
      return response;
    }
    async function login(role: "admin" | "staff", email: string, secret: string) {
      const csrf = await (await call("csrf")).json();
      return call(`callback/${role}`, { email, password: secret, csrfToken: csrf.csrfToken, callbackUrl: "/manage" });
    }
    async function resetAttempts() { await prisma!.rateLimitBucket.deleteMany(); }
    assert.equal(await (await call("session")).json(), null);
    assert.equal((await call("callback/admin", { email: "x", password: "x" }, "https://evil.test")).status, 403);
    assert.equal((await call("callback/admin", { email: "admin@example.test", password: process.env.ADMIN_PASSWORD })).status, 403);
    assert.equal(await prisma.appSession.count(), 0);
    assert.match((await (await login("admin", "admin@example.test", "wrong-password-value")).json()).url, /CredentialsSignin/);
    assert.match((await (await login("admin", "staff@example.test", password)).json()).url, /CredentialsSignin/);
    await resetAttempts();
    assert.equal((await login("admin", " ADMIN@example.test ", process.env.ADMIN_PASSWORD)).status, 200);
    const adminSession = await (await call("session")).json();
    assert.equal(adminSession.user.role, "ADMIN");
    assert.deepEqual(Object.keys(adminSession.user).sort(), ["id", "role"]);
    const savedCookie = cookie();
    const token = await getToken({ req: new Request(origin, { headers: { cookie: savedCookie } }), secret: process.env.AUTH_SECRET, secureCookie: false });
    assert(token);
    assert.equal(await resolveSession(token, new Date(Number(token.absoluteExpiry) - 1)) !== null, true);
    assert.equal(await resolveSession(token, new Date(Number(token.absoluteExpiry))), null);
    assert.match((await (await login("staff", "staff@example.test", password)).json()).url, /already_signed_in/);
    const csrf = await (await call("csrf")).json();
    assert.equal((await call("signout", { csrfToken: csrf.csrfToken })).status, 200);
    assert.equal(await resolveSession(token), null);
    assert.equal(await (await call("session", undefined, origin, savedCookie)).json(), null);
    await resetAttempts();
    await login("admin", "admin@example.test", process.env.ADMIN_PASSWORD);
    const currentAdminToken = await getToken({ req: new Request(origin, { headers: { cookie: cookie() } }), secret: process.env.AUTH_SECRET, secureCookie: false });
    process.env.ADMIN_AUTH_VERSION = "2";
    assert.equal(await resolveSession(currentAdminToken), null);
    process.env.ADMIN_AUTH_VERSION = "1";
    await prisma.adminAccount.update({ where: { id: ADMIN_ID }, data: { isActive: false } });
    assert.equal(await (await call("session")).json(), null);
    await login("staff", "staff@example.test", password);
    assert.equal((await (await call("session")).json()).user.role, "STAFF");
    assert.equal(await prisma.staffPermission.count(), 0);
    await prisma.staffAccount.update({ where: { id: staff.id }, data: { authVersion: 2 } });
    assert.equal(await (await call("session")).json(), null);
    await login("staff", "staff@example.test", password);
    await prisma.staffAccount.update({ where: { id: staff.id }, data: { isActive: false } });
    assert.equal(await (await call("session")).json(), null);
    assert.match((await (await login("staff", "staff@example.test", password)).json()).url, /CredentialsSignin/);
    await resetAttempts();
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => consumeLoginAttempt("STAFF", "parallel@example.test", new Request(origin))));
    for (const attempt of attempts) if (attempt.status === "rejected" && !(attempt.reason instanceof LoginRateLimited)) console.error("Concurrent attempt failure:", attempt.reason.name, attempt.reason.code);
    assert.equal(attempts.filter(x => x.status === "fulfilled").length, 5);
    assert.equal(attempts.filter(x => x.status === "rejected" && x.reason instanceof LoginRateLimited).length, 1);
    const limited = await login("staff", "parallel@example.test", password);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "900");
    // Expired events no longer count; success does not clear the counters.
    await prisma.rateLimitEvent.updateMany({ data: { occurredAt: new Date(Date.now() - 16 * 60_000) } });
    assert.equal((await login("staff", "parallel@example.test", password)).status, 200);
    await resetAttempts();
    await prisma.staffAccount.update({ where: { id: staff.id }, data: { isActive: true } });
    await login("staff", "staff@example.test", password);
    const beforeFailureCookie = cookie();
    const logoutCsrf = await (await call("csrf")).json();
    // Missing table simulates a DB read/write failure without interrupting the real DB.
    await pg.query(`ALTER TABLE "${schema}"."AppSession" RENAME TO "UnavailableSession"`);
    try {
      assert.equal((await call("session")).status, 503);
      const failedLogout = await call("signout", { csrfToken: logoutCsrf.csrfToken });
      assert.equal(failedLogout.status, 503);
      assert.equal(failedLogout.headers.getSetCookie().length, 0);
      assert.equal(cookie(), beforeFailureCookie);
    } finally { await pg.query(`ALTER TABLE "${schema}"."UnavailableSession" RENAME TO "AppSession"`); }
    assert.equal((await call("signout", { csrfToken: logoutCsrf.csrfToken })).status, 200);
    console.log("Auth integration passed: real NextAuth handlers, CSRF, credentials, roles, JWT/DB expiry and revocation, parallel rate limits, DB-failure logout retry (isolated schema).");
  } finally {
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
    await prisma?.$disconnect();
    await pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pg.end();
    rmSync(distDir, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { if (error instanceof Error) console.error(error.name, error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).join("\n")); console.error("Auth integration failed; inspect test assertions without logging credentials."); process.exitCode = 1; });
