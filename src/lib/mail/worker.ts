import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { decryptMailPayload, type MailPayload } from "@/lib/member/mail";

export type SendResult = { kind: "ACCEPTED" | "TRANSIENT" | "PERMANENT" | "UNKNOWN"; code?: "RATE_LIMITED" | "PROVIDER_TEMPORARY" | "PROVIDER_REJECTED" | "NETWORK_UNCERTAIN" | "PAYLOAD_INVALID" };
export type MailSender = (payload: MailPayload, requestKey: string) => Promise<SendResult>;
const retryDelay = [60_000, 5 * 60_000, 30 * 60_000];

function targetIsCurrent(delivery: Awaited<ReturnType<typeof loadDelivery>>, now: Date): boolean {
  if (!delivery || !delivery.encryptedPayload || !delivery.payloadExpiresAt || delivery.payloadExpiresAt <= now) return false;
  if (delivery.kind === "RESERVATION_CONFIRMED_MEMBER" || delivery.kind === "RESERVATION_CONFIRMED_ADMIN") {
    const reservation = delivery.reservation;
    return !!(reservation && reservation.status === "CONFIRMED" && reservation.version === delivery.reservationVersion && reservation.member.status === "ACTIVE" && !reservation.member.isDeleted && reservation.member.emailVerifiedAt);
  }
  if (delivery.kind === "RESERVATION_CANCELLED_MEMBER" || delivery.kind === "RESERVATION_CANCELLED_ADMIN") {
    const reservation = delivery.reservation;
    return !!(reservation && reservation.status === "CANCELLED" && reservation.cancellationKind === "NORMAL" && reservation.cancelledAt && reservation.version === delivery.reservationVersion && reservation.member.status === "ACTIVE" && !reservation.member.isDeleted && reservation.member.emailVerifiedAt);
  }
  if (delivery.kind === "RESERVATION_CHANGE") {
    const notice = delivery.notice;
    const reservation = notice?.reservation;
    return !!(notice && delivery.confirmationAuditId && reservation && !notice.resolvedAt && !["RESOLVED", "IMPACT_RESOLVED_PENDING_REVIEW"].includes(notice.responseStatus) && reservation.status === "CONFIRMED" && reservation.version === notice.reservationVersion && reservation.member.status === "ACTIVE" && !reservation.member.isDeleted);
  }
  const token = delivery.token;
  const member = token?.member;
  if (!token || !member || token.purpose !== delivery.kind || token.usedAt || token.revokedAt || token.expiresAt <= now || token.emailKey !== member.emailKey || token.authVersion !== member.authVersion) return false;
  if (delivery.kind === "MEMBERSHIP_CONFIRM") return member.status === "PENDING_EMAIL" && !member.isDeleted;
  if (delivery.kind === "RESTORE_CONFIRM") return member.status === "RESTORE_PENDING" && member.isDeleted && !!member.firstActivatedAt && token.restoreGeneration === member.restoreGeneration;
  return member.status === "ACTIVE" && !member.isDeleted && !!member.emailVerifiedAt;
}

async function loadDelivery(tx: Prisma.TransactionClient, id: string) {
  return tx.emailDelivery.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { member: true } }, token: { include: { member: true } }, notice: { include: { reservation: { include: { member: true } } } } } });
}

async function closeStaleLeases(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const rows = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EmailDelivery" WHERE status = 'SENDING' AND "leaseExpiresAt" <= clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 100`;
    const now = new Date();
    for (const { id } of rows) {
      const delivery = await tx.emailDelivery.findUniqueOrThrow({ where: { id }, select: { attemptCount: true } });
      await tx.emailDelivery.update({ where: { id }, data: { status: "UNKNOWN", closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
      await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: id, attemptNumber: delivery.attemptCount } }, data: { result: "UNKNOWN", finishedAt: now, errorCode: "LEASE_EXPIRED" } });
    }
    return rows.length;
  });
}

async function clearExpiredPayloads(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const rows = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EmailDelivery" WHERE status IN ('PENDING','RETRY_WAIT') AND "payloadExpiresAt" <= clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 100`;
    const now = new Date();
    for (const { id } of rows) await tx.emailDelivery.update({ where: { id }, data: { status: "EXPIRED", closedAt: now, nextAttemptAt: null, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null } });
    return rows.length;
  });
}

async function claimNext(db: PrismaClient, deliveryId?: string) {
  return db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const rows = deliveryId
      ? await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EmailDelivery" WHERE id = ${deliveryId}::uuid AND status IN ('PENDING','RETRY_WAIT') AND "nextAttemptAt" <= clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 1`
      : await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EmailDelivery" WHERE status IN ('PENDING','RETRY_WAIT') AND "nextAttemptAt" <= clock_timestamp() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    const delivery = await loadDelivery(tx, rows[0].id);
    const now = new Date();
    if (!targetIsCurrent(delivery, now) || delivery.attemptCount >= 4) {
      await tx.emailDelivery.update({ where: { id: delivery.id }, data: { status: delivery.attemptCount >= 4 ? "FAILED" : "EXPIRED", closedAt: now, nextAttemptAt: null, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null } });
      return { skipped: true as const };
    }
    const leaseId = randomUUID();
    const attemptNumber = delivery.attemptCount + 1;
    await tx.emailDelivery.update({ where: { id: delivery.id }, data: { status: "SENDING", attemptCount: attemptNumber, leaseId, leaseExpiresAt: new Date(now.getTime() + 60_000), nextAttemptAt: null } });
    await tx.emailDeliveryAttempt.create({ data: { deliveryId: delivery.id, attemptNumber, leaseId, startedAt: now } });
    return { skipped: false as const, id: delivery.id, leaseId, attemptNumber, requestKey: delivery.requestKey, encryptedPayload: delivery.encryptedPayload! };
  });
}

async function stillSendable(db: PrismaClient, claim: Exclude<Awaited<ReturnType<typeof claimNext>>, null | {skipped: true}>) {
  return db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${claim.id}::uuid FOR UPDATE`;
    const delivery = await loadDelivery(tx, claim.id);
    if (delivery.status !== "SENDING" || delivery.leaseId !== claim.leaseId) return false;
    if (targetIsCurrent(delivery, new Date())) return true;
    const now = new Date();
    await tx.emailDelivery.update({ where: { id: claim.id }, data: { status: "EXPIRED", closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
    await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claim.id, attemptNumber: claim.attemptNumber } }, data: { result: "PERMANENT_FAILURE", finishedAt: now, errorCode: "STALE_TARGET" } });
    return false;
  });
}

async function finish(db: PrismaClient, claim: Exclude<Awaited<ReturnType<typeof claimNext>>, null | {skipped: true}>, outcome: SendResult) {
  await db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${claim.id}::uuid FOR UPDATE`;
    const current = await tx.emailDelivery.findUniqueOrThrow({ where: { id: claim.id } });
    if (current.status !== "SENDING" || current.leaseId !== claim.leaseId) return;
    const now = new Date();
    const delay = retryDelay[claim.attemptNumber - 1];
    const canRetry = outcome.kind === "TRANSIENT" && claim.attemptNumber <= 3 && current.payloadExpiresAt && current.payloadExpiresAt > new Date(now.getTime() + delay);
    const status = outcome.kind === "ACCEPTED" ? "ACCEPTED" : canRetry ? "RETRY_WAIT" : outcome.kind === "UNKNOWN" ? "UNKNOWN" : outcome.kind === "TRANSIENT" && current.payloadExpiresAt && current.payloadExpiresAt <= new Date(now.getTime() + (delay ?? 0)) ? "EXPIRED" : "FAILED";
    await tx.emailDelivery.update({ where: { id: claim.id }, data: { status, leaseId: null, leaseExpiresAt: null, ...(status === "RETRY_WAIT" ? { nextAttemptAt: new Date(now.getTime() + delay) } : { nextAttemptAt: null, closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null }), ...(status === "ACCEPTED" ? { acceptedAt: now } : {}) } });
    await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claim.id, attemptNumber: claim.attemptNumber } }, data: { result: outcome.kind === "ACCEPTED" ? "ACCEPTED" : outcome.kind === "UNKNOWN" ? "UNKNOWN" : outcome.kind === "TRANSIENT" ? "TRANSIENT_FAILURE" : "PERMANENT_FAILURE", finishedAt: now, ...(outcome.kind === "ACCEPTED" ? {} : { errorCode: outcome.code ?? (outcome.kind === "UNKNOWN" ? "NETWORK_UNCERTAIN" : "PROVIDER_REJECTED") }) } });
  });
}

/** One bounded background run. Provider traffic always happens outside DB transactions. */
export async function runMailBatch(sender: MailSender, limit = 3, db: PrismaClient = getPrisma(), deliveryId?: string) {
  const stale = await closeStaleLeases(db);
  const expired = await clearExpiredPayloads(db);
  let attempted = 0;
  let skipped = 0;
  while (attempted < limit && skipped < 100) {
    const claim = await claimNext(db, deliveryId);
    if (!claim) break;
    if (claim.skipped) { skipped++; continue; }
    attempted++;
    let outcome: SendResult;
    try {
      const payload = decryptMailPayload(claim.encryptedPayload);
      if (!payload.from || !payload.to || !payload.subject || !payload.text) outcome = { kind: "PERMANENT", code: "PAYLOAD_INVALID" };
      else if (!await stillSendable(db, claim)) continue;
      else {
        try { outcome = await sender(payload, claim.requestKey); }
        catch { outcome = { kind: "UNKNOWN", code: "NETWORK_UNCERTAIN" }; }
      }
    } catch { outcome = { kind: "PERMANENT", code: "PAYLOAD_INVALID" }; }
    await finish(db, claim, outcome);
  }
  return { attempted, skipped, stale, expired };
}
