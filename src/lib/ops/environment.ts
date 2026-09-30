import { emailKey } from "../auth/policy";
/** Offline deployment checks. Errors contain variable names, never values. */
export function deploymentEnvironmentErrors(env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  const required = ["APP_ENV", "DATABASE_URL", "DIRECT_URL", "DEPLOYMENT_DB_HOST", "AUTH_URL", "AUTH_SECRET", "AUTH_RATE_LIMIT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_AUTH_VERSION", "MAIL_PAYLOAD_KEY", "RESEND_API_KEY", "RESEND_FROM", "CRON_SECRET", "OPS_SECRET"];
  for (const key of required) if (!env[key]?.trim()) errors.push(`${key}: required`);
  if (!["staging", "production"].includes(env.APP_ENV ?? "")) errors.push("APP_ENV: staging or production required");
  if (env.VERCEL_ENV === "preview" && env.APP_ENV !== "staging") errors.push("APP_ENV: preview must use staging");
  if (env.VERCEL_ENV === "development") errors.push("VERCEL_ENV: hosted check cannot use development");
  for (const key of ["AUTH_SECRET", "AUTH_RATE_LIMIT_SECRET", "CRON_SECRET", "OPS_SECRET"]) if ((env[key]?.length ?? 0) < 32) errors.push(`${key}: 32+ characters required`);
  const secrets = [env.AUTH_SECRET, env.AUTH_RATE_LIMIT_SECRET, env.CRON_SECRET, env.OPS_SECRET].filter(Boolean);
  if (new Set(secrets).size !== secrets.length) errors.push("Secrets: independent values required");
  if (!/^[1-9]\d*$/.test(env.ADMIN_AUTH_VERSION ?? "")) errors.push("ADMIN_AUTH_VERSION: positive integer required");
  if (!emailKey(env.ADMIN_EMAIL)) errors.push("ADMIN_EMAIL: valid email required");
  if (!env.RESEND_API_KEY?.startsWith("re_")) errors.push("RESEND_API_KEY: Resend key required");
  const password = [...(env.ADMIN_PASSWORD ?? "")].length;
  if (password < 15 || password > 128) errors.push("ADMIN_PASSWORD: 15-128 characters required");
  const payloadKey = env.MAIL_PAYLOAD_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(payloadKey) || Buffer.from(payloadKey, "base64").length !== 32) errors.push("MAIL_PAYLOAD_KEY: base64 of 32 bytes required");
  if (env.AUTH_TEST_TSCONFIG || env.MAIL_TEST_DISABLE_IMMEDIATE) errors.push("Test environment flags: forbidden in deployments");
  try {
    const origin = new URL(env.AUTH_URL!);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error();
  } catch { errors.push("AUTH_URL: HTTPS origin required"); }
  let app: URL | undefined, direct: URL | undefined;
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    try {
      const url = new URL(env[key]!);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || !url.username || !url.password || url.pathname === "/" || url.hash || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") || ![null, "public"].includes(url.searchParams.get("schema"))) throw new Error();
      if (key === "DATABASE_URL") app = url; else direct = url;
    } catch { errors.push(`${key}: Neon PostgreSQL public schema with TLS required`); }
  }
  if (app && direct) {
    if (!app.hostname.includes("-pooler.")) errors.push("DATABASE_URL: pooled endpoint required");
    if (direct.hostname.includes("-pooler.")) errors.push("DIRECT_URL: direct endpoint required");
    if (app.hostname.replace("-pooler.", ".") !== direct.hostname || app.pathname !== direct.pathname) errors.push("Database URLs: endpoint and database must match");
    if (direct.hostname !== env.DEPLOYMENT_DB_HOST) errors.push("DEPLOYMENT_DB_HOST: direct endpoint mismatch");
  }
  return errors;
}
