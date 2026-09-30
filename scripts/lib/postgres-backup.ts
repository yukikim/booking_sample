import { execFileSync } from "node:child_process";
/** Keep credentials out of argv, shell interpolation and CLI output. */
export function postgresTool(command: "pg_dump" | "pg_restore", connection: string, args: string[]) {
  const url = new URL(connection);
  const sslmode = url.searchParams.get("sslmode");
  const schema = url.searchParams.get("schema");
  if (schema && schema !== "public") throw new Error("Backup requires public schema.");
  try {
    execFileSync(command, args, { env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: sslmode ?? "prefer" }, stdio: "pipe", timeout: 120000 });
  } catch { throw new Error("PostgreSQL backup tool failed; verify version, connection and file locally."); }
}
