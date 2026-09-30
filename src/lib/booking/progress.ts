import "server-only";

import { createHash } from "node:crypto";
import { requireStoreMutation } from "@/lib/auth/store-mutation";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { lockBookingState } from "./lock";
import { BookingError } from "./mutations";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Step = "start" | "complete";

export async function progressReservation(request: Request, id: string, step: Step, value: unknown) {
  if (!uuid.test(id)) throw new BookingError(400, "InvalidInput");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BookingError(400, "InvalidInput");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["requestKey", "expectedVersion"].includes(key)) || typeof body.requestKey !== "string" || !uuid.test(body.requestKey) || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) throw new BookingError(400, "InvalidInput");
  const expectedVersion = body.expectedVersion as number;
  const requestKey = body.requestKey;
  const action = step === "start" ? "RESERVATION_START" : "RESERVATION_COMPLETE";
  const auditAction = step === "start" ? "RESERVATION_STARTED" : "RESERVATION_COMPLETED";
  const beforeStatus = step === "start" ? "CONFIRMED" : "IN_PROGRESS";
  const afterStatus = step === "start" ? "IN_PROGRESS" : "COMPLETED";
  const hash = createHash("sha256").update(JSON.stringify({ id, step, expectedVersion })).digest("hex");
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const actor = await requireStoreMutation(tx, request, action);
    await lockBookingState(tx);
    const oldAudit = await tx.auditLog.findUnique({ where: { requestKey } });
    if (oldAudit) {
      const owner = actor.role === "ADMIN" ? oldAudit.actorAdminId : oldAudit.actorStaffId;
      if (owner !== actor.principalId || oldAudit.action !== auditAction || oldAudit.targetId !== id || (oldAudit.changes as Record<string, unknown> | null)?.requestHash !== hash) throw new BookingError(409, "RequestKeyConflict");
      return { reservationId: id, version: expectedVersion + 1, status: afterStatus, replayed: true };
    }
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.reservation.findUnique({ where: { id } });
    if (!current) throw new BookingError(404, "NotFound");
    if (current.status !== beforeStatus || current.version !== expectedVersion) throw new BookingError(409, "VersionConflict");
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const updated = await tx.reservation.updateMany({ where: { id, status: beforeStatus, version: expectedVersion }, data: { status: afterStatus, version: { increment: 1 }, ...(step === "start" ? { actualStartedAt: now } : { actualCompletedAt: now }) } });
    if (updated.count !== 1) throw new BookingError(409, "VersionConflict");
    await tx.auditLog.create({ data: { requestKey, actorType: actor.role, ...(actor.role === "ADMIN" ? { actorAdminId: actor.principalId } : { actorStaffId: actor.principalId }), action: auditAction, targetType: "Reservation", targetId: id, changes: { requestHash: hash, beforeVersion: expectedVersion, resultVersion: expectedVersion + 1, resultStatus: afterStatus } } });
    return { reservationId: id, version: expectedVersion + 1, status: afterStatus, replayed: false };
  }, { timeout: 20_000 });
}
