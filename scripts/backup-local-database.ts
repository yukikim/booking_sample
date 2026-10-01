import { openSync, closeSync, unlinkSync } from "node:fs";
import { loadDevelopmentDatabase } from "./lib/development-database";
import { postgresTool } from "./lib/postgres-backup";

let created: string | undefined;
try {
  const [flag, output] = process.argv.slice(2);
  if (flag !== "--output" || !output || process.argv.length !== 4) throw new Error();
  const connection = loadDevelopmentDatabase();
  const fd = openSync(output, "wx", 0o600);
  closeSync(fd); created = output;
  postgresTool("pg_dump", connection, ["--format=custom", "--schema=public", "--no-owner", "--no-acl", "--file", output]);
  created = undefined;
  console.log("Local backup created (0600). Review its data before production import; encrypt and store securely.");
} catch {
  if (created) { try { unlinkSync(created); } catch { /* Operator cleanup if inaccessible. */ } }
  console.error("Local backup failed. Use npm run db:backup:local -- --output /secure/path/new.dump. Check local matching URLs, pg_dump and the output directory.");
  process.exitCode = 1;
}
