import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { assertLocalDatabase } from "../scripts/lib/local-database";

test("accepts local Compose addresses with the public schema", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.doesNotThrow(() =>
      assertLocalDatabase(`postgresql://user:password@${host}:5432/booking_sample?schema=public`),
    );
  }
  assert.doesNotThrow(() => assertLocalDatabase("postgres://localhost/booking_sample"));
});

const rejected: [string, string | undefined][] = [
  ["missing URL", undefined],
  ["invalid URL", "not-a-url"],
  ["remote host", "postgresql://example.invalid/booking_sample"],
  ["deceptive hostname", "postgresql://localhost.example.invalid/booking_sample"],
  ["wrong database", "postgresql://localhost/production"],
  ["wrong port", "postgresql://localhost:5433/booking_sample"],
  ["wrong protocol", "https://localhost/booking_sample"],
  ["host override", "postgresql://localhost/booking_sample?host=example.invalid"],
  ["wrong schema", "postgresql://localhost/booking_sample?schema=private"],
  ["duplicate schema", "postgresql://localhost/booking_sample?schema=public&schema=private"],
  ["fragment", "postgresql://localhost/booking_sample#extra"],
];

for (const [name, value] of rejected) {
  test(`rejects ${name} without including input in the error`, () => {
    assert.throws(() => assertLocalDatabase(value), {
      message: "Only the local Compose database is allowed.",
    });
  });
}

test("CLI refuses an external target and never prints its credentials", () => {
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "scripts/check-db.ts",
  ], {
    env: { ...process.env, DATABASE_URL: "postgresql://private-user:private-pass@example.invalid/booking_sample" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DB check failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-user|private-pass|example\.invalid/);
});

test("Prisma module refuses import without the server condition", () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "-e", "require('./src/lib/prisma.ts')",
  ], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Client Component/);
});
