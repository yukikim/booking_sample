import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { checkMutationOrigin, readJsonBody, requireStoreMutation, StoreInputError, mutationFailure } from "@/lib/auth/store-mutation";
import { lockBookingState } from "@/lib/booking/lock";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Status = "UNCONTACTED" | "AWAITING_CUSTOMER" | "IN_PROGRESS" | "RESOLVED";

export async function resolveNoticesAfterReservation(tx: Prisma.TransactionClient, reservationId: string, actor: { role: "MEMBER" | "STAFF" | "ADMIN"; id: string }, kind: "changed" | "cancelled") {
  const notices = await tx.reservationChangeNotice.findMany({ where: { reservationId, resolvedAt: null }, orderBy: { id: "asc" }, select: { id: true, version: true } });
  if (!notices.length) return;
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
  for (const notice of notices) {
    await tx.$queryRaw`SELECT id FROM "ReservationChangeNotice" WHERE id = ${notice.id}::uuid FOR UPDATE`;
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: actor.role, ...(actor.role === "MEMBER" ? { actorMemberId: actor.id } : actor.role === "STAFF" ? { actorStaffId: actor.id } : { actorAdminId: actor.id }), action: "CHANGE_NOTICE_RESOLVED", targetType: "ReservationChangeNotice", targetId: notice.id, changes: { reservationId, kind } } });
    await tx.reservationChangeNotice.update({ where: { id: notice.id }, data: { responseStatus: "RESOLVED", responseNote: `予約${kind === "changed" ? "変更" : "取消"}で対応完了（監査ID: ${audit.id}）`, resolvedAt: now, version: { increment: 1 } } });
    await tx.emailDelivery.updateMany({ where: { noticeId: notice.id, status: { in: ["PENDING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, nextAttemptAt: null, closedAt: now } });
  }
}

export async function updateAdjustmentResponse(request: Request, noticeId: string) {
  checkMutationOrigin(request);
  if (!uuid.test(noticeId)) throw new StoreInputError(400);
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StoreInputError(400);
  const input = body as Record<string, unknown>;
  const status = input.status as Status;
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (Object.keys(input).some(key => !["requestKey", "expectedVersion", "status", "note"].includes(key)) || typeof input.requestKey !== "string" || !uuid.test(input.requestKey) || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1 || !["UNCONTACTED", "AWAITING_CUSTOMER", "IN_PROGRESS", "RESOLVED"].includes(status) || !note || [...note].length > 1000) throw new StoreInputError(400);
  const requestHash = createHash("sha256").update(JSON.stringify({ noticeId, expectedVersion: input.expectedVersion, status, note })).digest("hex");
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const actor = await requireStoreMutation(tx, request, "NOTICE_UPDATE_RESPONSE");
    await lockBookingState(tx);
    const replay = await tx.auditLog.findUnique({ where: { requestKey: input.requestKey as string } });
    if (replay) {
      const owner = actor.role === "ADMIN" ? replay.actorAdminId : replay.actorStaffId;
      if (owner !== actor.principalId || replay.action !== "CHANGE_NOTICE_RESPONSE_UPDATED" || replay.targetId !== noticeId || (replay.changes as Record<string, unknown> | null)?.requestHash !== requestHash) throw new StoreInputError(409);
      return { status, replayed: true };
    }
    const ref = await tx.reservationChangeNotice.findUnique({ where: { id: noticeId }, select: { reservationId: true } });
    if (!ref) throw new StoreInputError(404);
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${ref.reservationId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ReservationChangeNotice" WHERE id = ${noticeId}::uuid FOR UPDATE`;
    const notice = await tx.reservationChangeNotice.findUniqueOrThrow({ where: { id: noticeId }, include: { reservation: { select: { status: true, version: true } } } });
    if (notice.version !== input.expectedVersion || notice.resolvedAt || notice.responseStatus === "RESOLVED") throw new StoreInputError(409);
    if (status === "RESOLVED" ? notice.responseStatus !== "IMPACT_RESOLVED_PENDING_REVIEW" && notice.reservation.status === "CONFIRMED" && notice.reservation.version === notice.reservationVersion : notice.responseStatus === "IMPACT_RESOLVED_PENDING_REVIEW" || notice.reservation.status !== "CONFIRMED") throw new StoreInputError(409);
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
    await tx.auditLog.create({ data: { requestKey: input.requestKey as string, actorType: actor.role, ...(actor.role === "ADMIN" ? { actorAdminId: actor.principalId } : { actorStaffId: actor.principalId }), action: "CHANGE_NOTICE_RESPONSE_UPDATED", targetType: "ReservationChangeNotice", targetId: noticeId, changes: { requestHash, beforeStatus: notice.responseStatus, resultStatus: status, beforeVersion: notice.version } } });
    await tx.reservationChangeNotice.update({ where: { id: noticeId }, data: { responseStatus: status, responseNote: note, ...(status === "RESOLVED" ? { resolvedAt: now } : {}), version: { increment: 1 } } });
    if (status === "RESOLVED") await tx.emailDelivery.updateMany({ where: { noticeId, status: { in: ["PENDING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, nextAttemptAt: null, closedAt: now } });
    return { status, replayed: false };
  }, { timeout: 20_000 });
}

export function adjustmentResponseFailure(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") return Response.json({ error: "Conflict" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  return mutationFailure(error);
}
