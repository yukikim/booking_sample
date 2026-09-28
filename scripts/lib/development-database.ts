import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertLocalDatabase } from "./local-database";

/** Mutation commands only target the same local public schema as the app. */
export function loadDevelopmentDatabase(): string {
  loadEnvConfig(process.cwd(), true);
  const direct = process.env.DIRECT_URL;
  const app = process.env.DATABASE_URL;
  assertLocalDatabase(direct);
  assertLocalDatabase(app);
  if (new URL(direct!).href !== new URL(app!).href) {
    throw new Error("DATABASE_URL and DIRECT_URL must match.");
  }
  return direct!;
}

/** Capture CLI output: failures must not leak connection details. */
export function runPrisma(args: string[], connectionString: string): void {
  try {
    execFileSync(process.execPath, [
      resolve("node_modules/prisma/build/index.js"), ...args,
      "--config", "prisma7.config.ts",
    ], {
      env: { ...process.env, DIRECT_URL: connectionString, DATABASE_URL: connectionString },
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch {
    throw new Error(`Prisma ${args.join(" ")} failed; inspect local migration state.`);
  }
}
