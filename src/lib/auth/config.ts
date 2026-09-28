import "server-only";
import { emailKey, validPassword } from "./policy";

export function authEnvironment() {
  const secret = process.env.AUTH_SECRET;
  const rateSecret = process.env.AUTH_RATE_LIMIT_SECRET;
  const url = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (!secret || secret.length < 32 || !rateSecret || rateSecret.length < 32 || secret === rateSecret || !["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && (url.protocol !== "https:" || !process.env.AUTH_URL))) throw new Error("Authentication configuration unavailable.");
  return { secret, rateSecret, origin: url.origin, secure: url.protocol === "https:" };
}
export function adminEnvironment() {
  const email = emailKey(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  const version = Number(process.env.ADMIN_AUTH_VERSION);
  if (!email || !validPassword(password) || !Number.isSafeInteger(version) || version < 1 || version > 2147483647) throw new Error("Administrator configuration unavailable.");
  return { email, password, version };
}
