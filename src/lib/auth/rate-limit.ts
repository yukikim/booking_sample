import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getPrisma, setTransactionSchema } from "../prisma";
import { authEnvironment } from "./config";
import type { StoreRole } from "./policy";

export class LoginRateLimited extends Error {}
function clientAddress(request: Request) {
  // Local development shares one bucket; arbitrary forwarding headers are ignored.
  if (process.env.NODE_ENV !== "production") return "local-development";
  if (process.env.VERCEL !== "1") throw new Error("Trusted ingress unavailable.");
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (!ip || !isIP(ip)) throw new Error("Trusted ingress unavailable.");
  // URL normalizes equivalent IPv6 spellings. Keep each full IPv6 address for now.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
}
export class MailRateLimited extends Error {}
export class TokenRateLimited extends Error {}
async function consumeLimited(scope: "MAIL_ADDRESS" | "MAIL_IP" | "TOKEN_IP", value: string, limit: number, windowMs: number, minIntervalMs = 0) {
  const keyDigest = createHmac("sha256", authEnvironment().rateSecret).update(value).digest("hex");
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    await tx.rateLimitBucket.upsert({ where: { scope_keyDigest: { scope, keyDigest } }, create: { scope, keyDigest, lastAttemptAt: new Date(0) }, update: { keyDigest } });
    await tx.$queryRaw`SELECT "keyDigest" FROM "RateLimitBucket" WHERE scope = ${scope}::"RateLimitScope" AND "keyDigest" = ${keyDigest} FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{now: Date}[]>`SELECT clock_timestamp() AS now`;
    const bucket = await tx.rateLimitBucket.findUniqueOrThrow({ where: { scope_keyDigest: { scope, keyDigest } } });
    if (minIntervalMs && now.getTime() - bucket.lastAttemptAt.getTime() < minIntervalMs) return false;
    const count = await tx.rateLimitEvent.count({ where: { scope, keyDigest, occurredAt: { gt: new Date(now.getTime() - windowMs), lte: now } } });
    if (count >= limit) return false;
    await tx.rateLimitEvent.create({ data: { scope, keyDigest, occurredAt: now } });
    await tx.rateLimitBucket.update({ where: { scope_keyDigest: { scope, keyDigest } }, data: { lastAttemptAt: now } });
    return true;
  });
}
export async function consumeMailRequest(email: string, request: Request) {
  if (!await consumeLimited("MAIL_IP", clientAddress(request), 20, 60 * 60_000)) throw new MailRateLimited();
  return consumeLimited("MAIL_ADDRESS", email, 5, 60 * 60_000, 60_000);
}
export async function consumeTokenAttempt(request: Request) {
  if (!await consumeLimited("TOKEN_IP", clientAddress(request), 30, 15 * 60_000)) throw new TokenRateLimited();
}
export async function consumeLoginAttempt(role: StoreRole, email: string, request: Request) {
  const { rateSecret } = authEnvironment();
  const digest = (value: string) => createHmac("sha256", rateSecret).update(value).digest("hex");
  const keys = [
    { scope: "LOGIN_ACCOUNT" as const, keyDigest: digest(`${role}:${email}`), limit: 5 },
    { scope: "LOGIN_IP" as const, keyDigest: digest(clientAddress(request)), limit: 30 },
  ];
  const allowed = await getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    // Consistent order plus row locks makes the moving window atomic across instances.
    for (const { scope, keyDigest } of keys) {
      await tx.rateLimitBucket.upsert({ where: { scope_keyDigest: { scope, keyDigest } }, create: { scope, keyDigest, lastAttemptAt: new Date() }, update: { keyDigest } });
      await tx.$queryRaw`SELECT "keyDigest" FROM "RateLimitBucket" WHERE scope = ${scope}::"RateLimitScope" AND "keyDigest" = ${keyDigest} FOR UPDATE`;
    }
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const start = new Date(now.getTime() - 15 * 60_000);
    for (const { scope, keyDigest, limit } of keys) {
      if (await tx.rateLimitEvent.count({ where: { scope, keyDigest, occurredAt: { gt: start, lte: now } } }) >= limit) return false;
    }
    for (const { scope, keyDigest } of keys) {
      await tx.rateLimitEvent.create({ data: { scope, keyDigest, occurredAt: now } });
      await tx.rateLimitBucket.update({ where: { scope_keyDigest: { scope, keyDigest } }, data: { lastAttemptAt: now } });
    }
    return true;
  });
  if (!allowed) throw new LoginRateLimited();
}
