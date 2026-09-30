import { readFileSync, openSync, closeSync, chmodSync, unlinkSync } from "node:fs";
import { parse } from "dotenv";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
import { postgresTool } from "./lib/postgres-backup";
let created: string | undefined;
try {
  const [flag, file, outFlag, output] = process.argv.slice(2);
  if (flag !== "--file" || outFlag !== "--output" || !file || !output || process.argv.length !== 6) throw new Error();
  const env = parse(readFileSync(file));
  if (deploymentEnvironmentErrors(env).length) throw new Error();
  const fd = openSync(output, "wx", 0o600); closeSync(fd); created = output;
  postgresTool("pg_dump", env.DIRECT_URL, ["--format=custom", "--no-owner", "--no-acl", "--file", output]);
  chmodSync(output, 0o600);
  created = undefined;
  process.stdout.write("Backup created. Encrypt and store outside the repository; retention and restore verification are required.\n");
} catch {
  if (created) { try { unlinkSync(created); } catch { /* Leave cleanup to the operator if inaccessible. */ } }
  process.stderr.write("Backup failed. Usage: npm run db:backup -- --file .env.production --output /secure/path/new.dump\n"); process.exitCode = 1;
}
