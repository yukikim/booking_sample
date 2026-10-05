import test from "node:test";
import assert from "node:assert/strict";
import { remoteSeedArguments, remoteSeedConnection } from "../scripts/lib/remote-seed";

const host = "ep-sample.region.neon.tech";
const env = () => ({
  APP_ENV: "production", DATABASE_URL: `postgresql://app:secret@ep-sample-pooler.region.neon.tech/neondb?sslmode=require`,
  DIRECT_URL: `postgresql://migration:secret@${host}/neondb?sslmode=require`, DEPLOYMENT_DB_HOST: host,
  AUTH_URL: "https://sample.example.test", AUTH_SECRET: "a".repeat(32), AUTH_RATE_LIMIT_SECRET: "b".repeat(32),
  CRON_SECRET: "c".repeat(32), OPS_SECRET: "d".repeat(32), ADMIN_EMAIL: "admin@example.test",
  ADMIN_PASSWORD: "test-password-123456", ADMIN_AUTH_VERSION: "1", MAIL_PAYLOAD_KEY: Buffer.alloc(32, 1).toString("base64"),
  RESEND_API_KEY: "re_fake", RESEND_FROM: "mail@example.test",
});

test("remote seed requires explicit file, host and database arguments", () => {
  assert.deepEqual(remoteSeedArguments(["--expected-database", "neondb", "--file", ".env.sample", "--expected-host", host]), { file: ".env.sample", host, database: "neondb" });
  for (const args of [[], ["--file", ".env.sample"], ["--unknown", "secret"], [".env.sample"]]) {
    assert.throws(() => remoteSeedArguments(args), /Usage:/);
  }
});

test("remote seed accepts matching Neon direct target and rejects wrong database/host", () => {
  const connection = new URL(remoteSeedConnection(env(), host, "neondb"));
  assert.equal(connection.searchParams.get("sslmode"), "verify-full");
  assert.equal(connection.hostname, host);
  assert.equal(connection.pathname, "/neondb");
  assert.throws(() => remoteSeedConnection(env(), host, "other"), /expected-database/);
  assert.throws(() => remoteSeedConnection(env(), "ep-other.region.neon.tech", "neondb"), /expected-host/);
});

test("remote seed rejects local, pooled, incomplete and mismatched settings without leaking secrets", () => {
  const sentinel = "sensitive-marker";
  for (const patch of [
    { DIRECT_URL: `postgresql://u:${sentinel}@localhost/neondb?sslmode=require` },
    { DIRECT_URL: env().DATABASE_URL }, { OPS_SECRET: "" },
    { DATABASE_URL: `postgresql://u:${sentinel}@ep-other-pooler.region.neon.tech/neondb?sslmode=require` },
  ]) {
    assert.throws(() => remoteSeedConnection({ ...env(), ...patch }, host, "neondb"), (error: unknown) => {
      assert(error instanceof Error);
      assert(!error.message.includes(sentinel));
      assert(!error.message.includes("postgresql://"));
      return true;
    });
  }
});

test("remote seed explicitly verifies TLS even when libpq compatibility was requested", () => {
  const settings = env();
  settings.DIRECT_URL += "&uselibpqcompat=true";
  const connection = new URL(remoteSeedConnection(settings, host, "neondb"));
  assert.equal(connection.searchParams.get("sslmode"), "verify-full");
  assert.equal(connection.searchParams.has("uselibpqcompat"), false);
});
