import { openSync, closeSync, unlinkSync } from "node:fs";
import { loadDevelopmentDatabase } from "./lib/development-database";
import { postgresTool } from "./lib/postgres-backup";

let created: string | undefined;
let stage: "arguments" | "environment" | "output" | "dump" = "arguments";
try {
  const [flag, output] = process.argv.slice(2);
  if (flag !== "--output" || !output || process.argv.length !== 4) throw new Error();
  stage = "environment";
  const connection = loadDevelopmentDatabase();
  stage = "output";
  const fd = openSync(output, "wx", 0o600);
  closeSync(fd); created = output;
  stage = "dump";
  postgresTool("pg_dump", connection, ["--format=custom", "--schema=public", "--no-owner", "--no-acl", "--file", output]);
  created = undefined;
  console.log("Local backup created (0600). Review its data before production import; encrypt and store securely.");
} catch (error: unknown) {
  if (created) { try { unlinkSync(created); } catch { /* Operator cleanup if inaccessible. */ } }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const reason = stage === "arguments" ? "Use npm run db:backup:local -- --output ./backups/new.dump."
    : stage === "environment" ? "Check matching local DATABASE_URL and DIRECT_URL (Compose booking_sample/public)."
    : stage === "output" && code === "ENOENT" ? "Output directory does not exist. Create the parent directory first (e.g. mkdir -p ./backups)."
    : stage === "output" && code === "EEXIST" ? "Output file already exists. Choose a new filename; backups are never overwritten."
    : stage === "output" ? "Cannot create output file. Check directory permissions and available disk space."
    : "pg_dump failed. Check that pg_dump is installed, its version supports the server, and the local database is running and accessible.";
  console.error(`Local backup failed. ${reason}`);
  process.exitCode = 1;
}
