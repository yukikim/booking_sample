import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { timingSafeEqual } from "node:crypto";
export function authorizedOps(request: Request, secret = process.env.OPS_SECRET) {
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
/** Counts only; no recipients, tokens, IDs or provider responses. Never sends mail. */
export async function operationsHealth(db: PrismaClient, now = new Date()) {
  const [due, failed, unknown, staleSending, oldest] = await Promise.all([
    db.emailDelivery.count({ where: { status: { in: ["PENDING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } } }),
    db.emailDelivery.count({ where: { status: "FAILED", closedAt: { gte: new Date(now.getTime() - 86400000) } } }),
    db.emailDelivery.count({ where: { status: "UNKNOWN" } }),
    db.emailDelivery.count({ where: { status: "SENDING", leaseExpiresAt: { lte: now } } }),
    db.emailDelivery.findFirst({ where: { status: { in: ["PENDING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
  ]);
  const overdueSeconds = oldest?.nextAttemptAt ? Math.max(0, Math.floor((now.getTime() - oldest.nextAttemptAt.getTime()) / 1000)) : 0;
  const attention = failed > 0 || unknown > 0 || staleSending > 0 || overdueSeconds >= 300;
  return { status: attention ? "attention" : "ok", mail: { due, failedLast24Hours: failed, unknown, staleSending, overdueSeconds } };
}
