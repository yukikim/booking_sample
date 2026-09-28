import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const local = "postgresql://booking:booking_local_password@127.0.0.1:5432/booking_sample?schema=public";
for (const script of ["scripts/migrate-local.ts", "prisma/seed.ts", "scripts/verify-database.ts"]) {
  for (const [name, direct] of [
    ["external target", "postgresql://never-print:secret@example.test/booking_sample"],
    ["mismatched credentials", local.replace("booking_local_password", "never-print-secret")],
    ["non-public schema", local.replace("public", "unexpected")],
  ]) {
    test(`${script} rejects ${name} before DB access without disclosing credentials`, () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", script], {
        env: { ...process.env, DATABASE_URL: local, DIRECT_URL: direct }, encoding: "utf8", timeout: 10000,
      });
      assert.equal(result.status, 1);
      const output = result.stdout + result.stderr;
      assert.doesNotMatch(output, /never-print|secret|booking_local_password|postgresql:\/\//);
    });
  }
}
