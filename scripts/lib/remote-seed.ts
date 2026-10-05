import { parseArgs } from "node:util";
import { deploymentEnvironmentErrors } from "../../src/lib/ops/environment";

export class RemoteSeedConfigurationError extends Error {}

export function remoteSeedArguments(args: string[]) {
  try {
    const { values } = parseArgs({ args, options: {
      file: { type: "string" },
      "expected-host": { type: "string" },
      "expected-database": { type: "string" },
    }, strict: true, allowPositionals: false });
    if (!values.file || !values["expected-host"] || !values["expected-database"]) throw new Error();
    return { file: values.file, host: values["expected-host"], database: values["expected-database"] };
  } catch {
    throw new RemoteSeedConfigurationError("Usage: npm run db:seed:remote -- --file .env.sample --expected-host HOST --expected-database DATABASE");
  }
}

/** Validate before connecting; all errors contain requirements, never values. */
export function remoteSeedConnection(env: Record<string, string>, host: string, database: string): string {
  const errors = deploymentEnvironmentErrors(env);
  if (env.DEPLOYMENT_DB_HOST !== host) errors.push("--expected-host: DEPLOYMENT_DB_HOST mismatch");
  try {
    const direct = new URL(env.DIRECT_URL);
    if (direct.hostname !== host) errors.push("--expected-host: DIRECT_URL hostname mismatch");
    if (decodeURIComponent(direct.pathname.slice(1)) !== database) errors.push("--expected-database: DIRECT_URL database mismatch");
  } catch {
    errors.push("DIRECT_URL: valid database URL required");
  }
  if (errors.length) throw new RemoteSeedConfigurationError(errors.join("\n"));
  const direct = new URL(env.DIRECT_URL);
  // Make certificate/hostname verification explicit instead of relying on pg aliases.
  direct.searchParams.set("sslmode", "verify-full");
  direct.searchParams.delete("uselibpqcompat");
  return direct.href;
}
