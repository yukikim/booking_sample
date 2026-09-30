import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { deploymentEnvironmentErrors } from "../src/lib/ops/environment";
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--file")) throw new Error();
  // Explicit file replaces, rather than merges with, the shell/local environment.
  const env = args.length ? parse(readFileSync(args[1])) : process.env;
  const errors = deploymentEnvironmentErrors(env);
  if (errors.length) { process.stderr.write(errors.join("\n") + "\n"); process.exitCode = 1; }
  else process.stdout.write("Deployment environment checks passed (offline; connection and cross-environment isolation not verified).\n");
} catch { process.stderr.write("Environment check failed. Usage: npm run env:check -- [--file .env.staging]\n"); process.exitCode = 1; }
