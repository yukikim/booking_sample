import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--file") throw new Error();
  const env = parse(readFileSync(args[1]));
  if (deploymentEnvironmentErrors(env).length) throw new Error();
  const origin = new URL(env.AUTH_URL).origin;
  for (const path of ["/", "/book", "/login", "/admin/login", "/staff/login"]) {
    const result = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (result.status !== 200 || !result.headers.get("content-type")?.includes("text/html")) throw new Error();
  }
  const denied = await fetch(origin + "/api/reservations", { redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (denied.status !== 401) throw new Error();
  const health = await fetch(origin + "/api/ops/health", { headers: { authorization: `Bearer ${env.OPS_SECRET}` }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (health.status !== 200 || (await health.json()).status !== "ok") throw new Error();
  process.stdout.write("Read-only deployment smoke passed. Authenticated booking/admin flows and actual mail still require verification.\n");
}
main().catch(() => { process.stderr.write("Deployment smoke failed. Check environment, deployment protection, status and operations health locally.\n"); process.exitCode = 1; });
