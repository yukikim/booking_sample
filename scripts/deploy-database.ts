import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
import { runPrisma } from "./lib/development-database";
import { Client } from "pg";
import { ADMIN_ID } from "../src/lib/auth/policy";
async function main() {
  const [fileFlag, file, hostFlag, host, actionFlag, action] = process.argv.slice(2);
  if (process.argv.length !== 8 || fileFlag !== "--file" || hostFlag !== "--expected-host" || actionFlag !== "--action" || !["status", "deploy", "bootstrap"].includes(action)) throw new Error();
  const env = parse(readFileSync(file));
  if (deploymentEnvironmentErrors(env).length || env.DEPLOYMENT_DB_HOST !== host) throw new Error();
  if (action !== "bootstrap") runPrisma(["migrate", action], env.DIRECT_URL);
  else {
    const db = new Client({ connectionString: env.DIRECT_URL }); await db.connect();
    try {
      // Only the fixed administrator; no sample members, resources or schedules.
      await db.query('INSERT INTO "public"."AdminAccount" (id,"displayName","updatedAt") VALUES ($1,$2,clock_timestamp()) ON CONFLICT (id) DO NOTHING', [ADMIN_ID, "管理者"]);
    } finally { await db.end(); }
  }
  console.log("Deployment database action completed. Verify the release record and target independently.");
}
main().catch(() => { console.error("Deployment DB action failed. Use --file, --expected-host and --action status|deploy|bootstrap; inspect target and migration state locally."); process.exitCode = 1; });
