import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getToken } from "next-auth/jwt";
import type { Prisma } from "@/generated/prisma/client";
import { authEnvironment } from "@/lib/auth/config";
import { StoreAccessError } from "@/lib/auth/permissions";
import { claimsFrom, type SessionClaims } from "@/lib/auth/policy";
import { resolveSession } from "@/lib/auth/session";
import { checkMutationOrigin, readJsonBody, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";
import { lockBookingState } from "@/lib/booking/lock";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { withdrawalReviewToken } from "./withdraw-review";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type WithdrawalKind = "VOLUNTARY_WITHDRAWAL" | "FORCED_WITHDRAWAL";
type Actor = { role: "MEMBER" | "STAFF" | "ADMIN"; id: string };
type Input = { requestKey: string; expectedVersion: number; reason: string | null; operation: "self" | "force" | "delete"; reviewToken?: string };

export class WithdrawalError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409, readonly code: string) { super(code); }
}
function invalid(): never { throw new WithdrawalError(400, "InvalidInput"); }
function parse(value: unknown, operation: Input["operation"]): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const allowed = operation === "self" ? ["requestKey", "expectedVersion", "reason", "reviewToken"] : ["requestKey", "expectedVersion", "reason", "operation", "reviewToken"];
  if (Object.keys(row).some(key => !allowed.includes(key)) || typeof row.requestKey !== "string" || !uuid.test(row.requestKey) || !Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1) return invalid();
  if (operation !== "self" && row.operation !== operation) return invalid();
  const reason = typeof row.reason === "string" ? row.reason.trim() : null;
  if (row.reviewToken !== undefined && (typeof row.reviewToken !== "string" || !/^[0-9a-f]{64}$/.test(row.reviewToken))) return invalid();
  if (
    (row.reason !== undefined && row.reason !== null && typeof row.reason !== "string") ||
    (reason !== null && [...reason].length > 1000) ||
    (operation === "self" && !reason)
  ) return invalid();
  return { requestKey: row.requestKey, expectedVersion: row.expectedVersion as number, reason, operation, ...(row.reviewToken ? { reviewToken: row.reviewToken as string } : {}) };
}
function hash(memberId: string, input: Input) { return createHash("sha256").update(JSON.stringify({ memberId, ...input })).digest("hex"); }
async function memberClaims(request: Request, tx: Prisma.TransactionClient): Promise<SessionClaims> {
  const env = authEnvironment();
  const token = await getToken({ req: new Request(env.origin, { headers: { cookie: request.headers.get("cookie") ?? "" } }), secret: env.secret, secureCookie: env.secure });
  const claims = claimsFrom(token);
  if (!claims) throw new WithdrawalError(401, "Unauthorized");
  if (claims.role !== "MEMBER") throw new WithdrawalError(403, "Forbidden");
  if (!await resolveSession(claims, new Date(), tx)) throw new WithdrawalError(401, "Unauthorized");
  return claims;
}
async function confirmMemberSession(tx: Prisma.TransactionClient, claims: SessionClaims) {
  await tx.$queryRaw`SELECT id FROM "AppSession" WHERE id = ${claims.sid}::uuid FOR UPDATE`;
  if (!await resolveSession(claims, new Date(), tx)) throw new WithdrawalError(401, "Unauthorized");
}
async function clock(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return rows[0].now;
}
async function repeat(tx: Prisma.TransactionClient, memberId: string, actor: Actor, input: Input, action: string) {
  const old = await tx.auditLog.findUnique({ where: { requestKey: input.requestKey } });
  if (!old) return null;
  const owner = actor.role === "MEMBER" ? old.actorMemberId : actor.role === "STAFF" ? old.actorStaffId : old.actorAdminId;
  const details = old.changes as Record<string, unknown> | null;
  if (old.action !== action || old.targetId !== memberId || owner !== actor.id || details?.requestHash !== hash(memberId, input)) throw new WithdrawalError(409, "RequestKeyConflict");
  return { memberId, status: "WITHDRAWN" as const, version: details.resultVersion as number, cancelledCount: details.cancelledCount as number, replayed: true };
}
function auditActor(actor: Actor) { return { actorType: actor.role, ...(actor.role === "MEMBER" ? { actorMemberId: actor.id } : actor.role === "STAFF" ? { actorStaffId: actor.id } : { actorAdminId: actor.id }) } as const; }

async function performWithdrawal(tx: Prisma.TransactionClient, memberId: string, actor: Actor, input: Input, claims?: SessionClaims) {
  await lockBookingState(tx);
  const action = input.operation === "self" ? "MEMBER_WITHDRAWN" : input.operation === "delete" ? "MEMBER_DELETED" : "MEMBER_FORCED_WITHDRAWN";
  // A store retry can return its original receipt after the member has been withdrawn.
  if (actor.role !== "MEMBER") {
    const repeated = await repeat(tx, memberId, actor, input, action);
    if (repeated) return repeated;
  }
  await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${memberId}::uuid FOR UPDATE`;
  const member = await tx.member.findUnique({ where: { id: memberId } });
  if (!member) throw new WithdrawalError(404, "NotFound");
  if (claims) await confirmMemberSession(tx, claims);
  if (actor.role === "MEMBER") {
    const repeated = await repeat(tx, memberId, actor, input, action);
    if (repeated) return repeated;
  }
  if (member.version !== input.expectedVersion || member.status === "WITHDRAWN" || actor.role === "MEMBER" && (member.status !== "ACTIVE" || member.isDeleted)) throw new WithdrawalError(409, "MemberStateChanged");
  const now = await clock(tx);
  const kind: WithdrawalKind = actor.role === "MEMBER" ? "VOLUNTARY_WITHDRAWAL" : "FORCED_WITHDRAWAL";
  // Lock every still-unstarted reservation in a stable order. A late CONFIRMED
  // reservation is still unstarted and must be cancelled regardless of cutoff.
  await tx.$queryRaw`SELECT id FROM "Reservation" WHERE "memberId" = ${memberId}::uuid AND status = 'CONFIRMED' ORDER BY id FOR UPDATE`;
  const reservations = await tx.reservation.findMany({ where: { memberId, status: "CONFIRMED" }, orderBy: { id: "asc" }, select: { id: true, version: true } });
  if (input.reviewToken && input.reviewToken !== withdrawalReviewToken(memberId, member.version, reservations)) throw new WithdrawalError(409, "ReservationSetChanged");
  const lifecycleAudit = await tx.auditLog.create({ data: { requestKey: input.requestKey, ...auditActor(actor), action, targetType: "Member", targetId: memberId, changes: { requestHash: hash(memberId, input), resultVersion: member.version + 1, cancelledCount: reservations.length, kind } } });
  const next = await tx.member.update({ where: { id: memberId }, data: { status: "WITHDRAWN", isDeleted: true, authVersion: { increment: 1 }, version: { increment: 1 }, ...(member.status === "RESTORE_PENDING" ? { restoreGeneration: { increment: 1 } } : {}) } });
  await tx.memberLifecycleEvent.create({ data: { memberId, kind, reason: input.reason, restoreGeneration: next.restoreGeneration, createdAt: now, auditId: lifecycleAudit.id } });
  for (const reservation of reservations) {
    const cancelAudit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: "SYSTEM", action: "RESERVATION_CANCELLED_WITHDRAWAL", targetType: "Reservation", targetId: reservation.id, changes: { withdrawalAuditId: lifecycleAudit.id, beforeVersion: reservation.version } } });
    const changed = await tx.reservation.updateMany({ where: { id: reservation.id, version: reservation.version, status: "CONFIRMED" }, data: { status: "CANCELLED", version: { increment: 1 }, cancelledAt: now, cancellationKind: "MEMBER_WITHDRAWAL", cancellationAuditId: cancelAudit.id } });
    if (changed.count !== 1) throw new WithdrawalError(409, "ReservationStateChanged");
    await tx.reservationSlot.deleteMany({ where: { reservationId: reservation.id } });
  }
  await tx.authToken.updateMany({ where: { memberId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  await tx.emailDelivery.updateMany({ where: { token: { memberId }, status: { in: ["PENDING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, nextAttemptAt: null, closedAt: now } });
  await tx.appSession.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: now } });
  return { memberId, status: "WITHDRAWN" as const, version: next.version, cancelledCount: reservations.length, replayed: false };
}

export async function withdrawSelf(request: Request) {
  checkMutationOrigin(request);
  const input = parse(await readJsonBody(request), "self");
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const claims = await memberClaims(request, tx);
    return performWithdrawal(tx, claims.principalId, { role: "MEMBER", id: claims.principalId }, input, claims);
  }, { timeout: 20_000 });
}

export async function withdrawManaged(request: Request, memberId: string) {
  checkMutationOrigin(request);
  if (!uuid.test(memberId)) return invalid();
  const body = await readJsonBody(request);
  const operation = body && typeof body === "object" && "operation" in body ? body.operation : null;
  if (operation !== "force" && operation !== "delete") return invalid();
  const input = parse(body, operation);
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, operation === "delete" ? "MEMBER_DELETE" : "MEMBER_FORCE_WITHDRAW");
    return performWithdrawal(tx, memberId, { role: claims.role, id: claims.principalId }, input);
  }, { timeout: 20_000 });
}

export function withdrawalFailure(error: unknown) {
  const prismaCode = error && typeof error === "object" && "code" in error ? error.code : null;
  const status = error instanceof WithdrawalError || error instanceof StoreAccessError || error instanceof StoreInputError ? error.status : ["P2002", "P2034"].includes(String(prismaCode)) ? 409 : 503;
  return Response.json({ error: error instanceof WithdrawalError ? error.code : status === 400 ? "InvalidInput" : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "NotFound" : status === 409 ? "Conflict" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
}
