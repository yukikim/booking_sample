import { readFileSync, openSync, readSync, closeSync } from "node:fs";
import { parse } from "dotenv";
import { Client } from "pg";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
import { postgresTool } from "./lib/postgres-backup";
import { quarantineRestoredDatabase } from "./lib/recovery";

async function main() {
  const [fileFlag, file, inputFlag, input, hostFlag, host, dbFlag, database, confirmFlag] = process.argv.slice(2);
  if (process.argv.length !== 11 || fileFlag !== "--file" || inputFlag !== "--input" || hostFlag !== "--expected-host" || dbFlag !== "--expected-database" || confirmFlag !== "--confirm-empty-production-import" || !file || !input || !host || !database) throw new Error("Invalid arguments.");
  const env = parse(readFileSync(file));
  if (deploymentEnvironmentErrors(env).length || env.APP_ENV !== "production") throw new Error("Production environment validation failed.");
  const target = new URL(env.DIRECT_URL);
  if (target.hostname !== host || decodeURIComponent(target.pathname.slice(1)) !== database) throw new Error("Target host/database mismatch.");
  const archive = Buffer.alloc(5);
  const fd = openSync(input, "r");
  try { readSync(fd, archive, 0, 5, 0); } finally { closeSync(fd); }
  if (archive.toString() !== "PGDMP") throw new Error("A custom-format pg_dump archive is required.");
  const db = new Client({ connectionString: env.DIRECT_URL });
  await db.connect();
  try {
    // This lock serializes this tool; the target must also be disconnected from applications/migrations.
    await db.query("SELECT pg_advisory_lock(731024001)");
    const existing = await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' LIMIT 1");
    if (existing.rowCount) throw new Error("Target public schema is not empty. Use a new disconnected database/branch.");
    postgresTool("pg_restore", env.DIRECT_URL, ["--dbname", database, "--schema=public", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", input]);
    await quarantineRestoredDatabase(db);
    console.log("Production import completed; sessions/tokens revoked and pending mail quarantined. Keep the target offline until migrations, data, permissions and credentials are verified.");
  } finally { await db.end(); }
}
main().catch((error: unknown) => {
  const safeMessages = ["Invalid arguments.", "Production environment validation failed.", "Target host/database mismatch.", "A custom-format pg_dump archive is required.", "Target public schema is not empty. Use a new disconnected database/branch."];
  console.error(error instanceof Error && safeMessages.includes(error.message) ? error.message : "Import failed. Keep the target offline; inspect restore/quarantine state locally. No automatic retry or cleanup is performed.");
  console.error("Usage: npm run db:import:production -- --file .env.production --input /secure/path/local.dump --expected-host HOST --expected-database DATABASE --confirm-empty-production-import");
  process.exitCode = 1;
});
