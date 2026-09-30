import test from "node:test";
import assert from "node:assert/strict";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
const valid = (): Record<string, string | undefined> => ({ APP_ENV: "staging", VERCEL_ENV: "preview", DATABASE_URL: "postgresql://app:fake@ep-staging-pooler.region.neon.tech/neondb?sslmode=require", DIRECT_URL: "postgresql://migration:fake@ep-staging.region.neon.tech/neondb?sslmode=require", DEPLOYMENT_DB_HOST: "ep-staging.region.neon.tech", AUTH_URL: "https://staging.example.test", AUTH_SECRET: "a".repeat(64), AUTH_RATE_LIMIT_SECRET: "b".repeat(64), CRON_SECRET: "c".repeat(32), OPS_SECRET: "d".repeat(32), ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD: "test-password-123456", ADMIN_AUTH_VERSION: "1", MAIL_PAYLOAD_KEY: Buffer.alloc(32, 1).toString("base64"), RESEND_API_KEY: "re_fake", RESEND_FROM: "mail@example.test" });
test("staging and production support different app/migration roles on same endpoint", () => {
  assert.deepEqual(deploymentEnvironmentErrors(valid()), []);
  assert.deepEqual(deploymentEnvironmentErrors({ ...valid(), APP_ENV: "production", VERCEL_ENV: "production" }), []);
});
test("preview cannot claim production; endpoint mismatch and pooled migration are rejected", () => {
  for (const patch of [{ APP_ENV: "production" }, { DEPLOYMENT_DB_HOST: "ep-production.region.neon.tech" }, { DIRECT_URL: valid().DATABASE_URL }, { DATABASE_URL: valid().DIRECT_URL }, { DIRECT_URL: "postgresql://migration:fake@ep-other.region.neon.tech/neondb?sslmode=require" }]) assert(deploymentEnvironmentErrors({ ...valid(), ...patch }).length);
});
test("TLS, local targets, weak/shared secrets and test bypass flags fail without leaking values", () => {
  const sentinel = "sensitive-marker";
  for (const patch of [{ DIRECT_URL: `postgresql://u:${sentinel}@localhost/booking_sample` }, { AUTH_URL: `https://site.test/?token=${sentinel}` }, { AUTH_SECRET: sentinel }, { OPS_SECRET: valid().CRON_SECRET }, { MAIL_PAYLOAD_KEY: sentinel }, { MAIL_TEST_DISABLE_IMMEDIATE: "1" }, { ADMIN_PASSWORD: sentinel.slice(0, 5) }]) {
    const errors = deploymentEnvironmentErrors({ ...valid(), ...patch });
    assert(errors.length); assert(!errors.join().includes(sentinel));
  }
});
