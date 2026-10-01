import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("production import rejects missing confirmation before reading environment or connecting", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-production-database.ts", "--file", "/missing", "--input", "/missing", "--expected-host", "localhost", "--expected-database", "booking_sample"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid arguments/);
});

test("production import rejects local configuration without exposing credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "transfer-guard-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, "APP_ENV=development\nDIRECT_URL=postgresql://booking:secret-test-password@localhost:5432/booking_sample\n", { mode: 0o600 });
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-production-database.ts", "--file", file, "--input", "/missing", "--expected-host", "localhost", "--expected-database", "booking_sample", "--confirm-empty-production-import"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Production environment validation failed/);
    assert.doesNotMatch(result.stderr + result.stdout, /secret-test-password/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
