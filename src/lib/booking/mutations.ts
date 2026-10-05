import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getToken } from "next-auth/jwt";
import type { Prisma } from "@/generated/prisma/client";
import { authEnvironment } from "@/lib/auth/config";
import { claimsFrom, type SessionClaims } from "@/lib/auth/policy";
import { resolveSession } from "@/lib/auth/session";
import { checkMutationOrigin, StoreInputError } from "@/lib/auth/store-mutation";
import { StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { parseBusinessDate } from "@/lib/schedules/calendar";
import { cancellationDeadline } from "./deadline";
import { parseAvailabilityRequest, revalidateAtSave, type AvailabilityRequest } from "./availability";
import { lockBookingState } from "./lock";
import { queueReservationConfirmation, queueReservationCancellation } from "@/lib/mail/reservation-confirmation";
import { dispatchMailAfterResponse } from "@/lib/mail/immediate";
import { resolveNoticesAfterReservation } from "@/lib/manage/adjustment-response";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Actor = { role: SessionClaims["role"]; id: string; claims?: SessionClaims };
type Selection = AvailabilityRequest & { startsAt: string; notes: string | null; quote: { totalDurationMinutes: number; totalPriceYen: number }; memberId?: string; roomId?: string; therapistId?: string };
type Command = { requestKey: string; storeException: boolean; exceptionReason: string | null };

export class BookingError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string) { super(code); }
}
const invalid = () => { throw new BookingError(400, "InvalidInput"); };
function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowed.includes(key))) return invalid();
  return row;
}
function key(value: unknown) { if (typeof value !== "string" || !uuid.test(value)) return invalid(); return value; }
function command(row: Record<string, unknown>): Command {
  const requestKey = key(row.requestKey);
  if (row.storeException !== undefined && typeof row.storeException !== "boolean") return invalid();
  const storeException = row.storeException === true;
  const exceptionReason = typeof row.exceptionReason === "string" ? row.exceptionReason.trim() : null;
  if ((storeException && (!exceptionReason || [...exceptionReason].length > 1000)) || (!storeException && row.exceptionReason !== undefined)) return invalid();
  return { requestKey, storeException, exceptionReason };
}
function selection(row: Record<string, unknown>, allowMemberId: boolean, allowAssignment = false): Selection {
  let base: AvailabilityRequest;
  try { base = parseAvailabilityRequest({ date: row.date, treatmentId: row.treatmentId, optionIds: row.optionIds }); }
  catch { return invalid(); }
  if (typeof row.startsAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/.test(row.startsAt) || Number.isNaN(Date.parse(row.startsAt)) || new Date(row.startsAt).toISOString() !== row.startsAt) return invalid();
  const notes = row.notes === undefined || row.notes === null || row.notes === "" ? null : row.notes;
  if (notes !== null && (typeof notes !== "string" || [...notes].length > 1000 || notes.includes("\u0000"))) return invalid();
  const quote = object(row.quote, ["totalDurationMinutes", "totalPriceYen"]);
  if (!Number.isSafeInteger(quote.totalDurationMinutes) || (quote.totalDurationMinutes as number) < 1 || (quote.totalDurationMinutes as number) > 1380 || !Number.isSafeInteger(quote.totalPriceYen) || (quote.totalPriceYen as number) < 0 || (quote.totalPriceYen as number) > 1_000_000) return invalid();
  if (row.memberId !== undefined && (!allowMemberId || typeof row.memberId !== "string" || !uuid.test(row.memberId))) return invalid();
  if ((row.roomId !== undefined || row.therapistId !== undefined) && (!allowAssignment || typeof row.roomId !== "string" || !uuid.test(row.roomId) || typeof row.therapistId !== "string" || !uuid.test(row.therapistId))) return invalid();
  return { ...base, startsAt: row.startsAt, notes, quote: { totalDurationMinutes: quote.totalDurationMinutes as number, totalPriceYen: quote.totalPriceYen as number }, ...(row.memberId ? { memberId: row.memberId as string } : {}), ...(row.roomId ? { roomId: row.roomId as string, therapistId: row.therapistId as string } : {}) };
}
export function parseCreate(value: unknown) {
  const row = object(value, ["requestKey", "memberId", "date", "startsAt", "treatmentId", "optionIds", "quote", "notes"]);
  return { ...command(row), ...selection(row, true) };
}
export function parseChange(value: unknown) {
  const row = object(value, ["requestKey", "expectedVersion", "date", "startsAt", "treatmentId", "optionIds", "quote", "notes", "roomId", "therapistId", "storeException", "exceptionReason"]);
  if (!Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1) return invalid();
  return { ...command(row), ...selection(row, false, true), expectedVersion: row.expectedVersion as number };
}
export function parseCancel(value: unknown) {
  const row = object(value, ["requestKey", "expectedVersion", "reason", "storeException", "exceptionReason"]);
  if (!Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1) return invalid();
  const reason = row.reason === undefined || row.reason === null || row.reason === "" ? null : row.reason;
  if (reason !== null && (typeof reason !== "string" || !reason.trim() || [...reason].length > 1000)) return invalid();
  return { ...command(row), expectedVersion: row.expectedVersion as number, reason: reason as string | null };
}

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function authorize(tx: Prisma.TransactionClient, request: Request, action: "RESERVATION_CREATE" | "RESERVATION_UPDATE" | "RESERVATION_CANCEL", exception: boolean): Promise<Actor> {
  checkMutationOrigin(request);
  const env = authEnvironment();
  const token = await getToken({ req: new Request(env.origin, { headers: { cookie: request.headers.get("cookie") ?? "" } }), secret: env.secret, secureCookie: env.secure });
  const claims = claimsFrom(token);
  if (!claims) throw new BookingError(401, "Unauthorized");
  if (claims.role === "MEMBER") {
    if (exception) throw new BookingError(403, "Forbidden");
    if (!await resolveSession(claims, new Date(), tx)) throw new BookingError(401, "Unauthorized");
    return { role: claims.role, id: claims.principalId, claims };
  }
  await tx.$queryRaw`SELECT id FROM "AppSession" WHERE id = ${claims.sid}::uuid FOR UPDATE`;
  if (!await resolveSession(claims, new Date(), tx)) throw new BookingError(401, "Unauthorized");
  if (claims.role === "ADMIN") {
    await tx.$queryRaw`SELECT id FROM "AdminAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
    const grants = await tx.staffPermission.findMany({ where: { staffId: claims.principalId, permission: { in: exception ? [action, "RESERVATION_EXCEPTION"] : [action] } }, select: { permission: true } });
    if (!grants.some(grant => grant.permission === action) || exception && !grants.some(grant => grant.permission === "RESERVATION_EXCEPTION")) throw new BookingError(403, "Forbidden");
  }
  return { role: claims.role, id: claims.principalId };
}
async function confirmMemberSession(tx: Prisma.TransactionClient, actor: Actor) {
  if (actor.role !== "MEMBER" || !actor.claims) return;
  await tx.$queryRaw`SELECT id FROM "AppSession" WHERE id = ${actor.claims.sid}::uuid FOR UPDATE`;
  if (!await resolveSession(actor.claims, new Date(), tx)) throw new BookingError(401, "Unauthorized");
}
async function bookableMember(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.member.findUnique({ where: { id } });
  if (!row || row.status !== "ACTIVE" || row.isDeleted || !row.emailVerifiedAt) throw new BookingError(403, "MemberNotBookable");
  return row;
}
async function lockCatalog(tx: Prisma.TransactionClient, input: Selection) {
  await tx.$queryRaw`SELECT id FROM "Treatment" WHERE id = ${input.treatmentId}::uuid FOR SHARE`;
  for (const id of [...input.optionIds].sort()) await tx.$queryRaw`SELECT id FROM "Option" WHERE id = ${id}::uuid FOR SHARE`;
}
async function clock(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return rows[0].now;
}
async function replay(tx: Prisma.TransactionClient, actor: Actor, action: string, requestKey: string, hash: string) {
  const old = await tx.auditLog.findUnique({ where: { requestKey } });
  if (!old) return null;
  const owner = actor.role === "MEMBER" ? old.actorMemberId : actor.role === "STAFF" ? old.actorStaffId : old.actorAdminId;
  if (old.action !== action || owner !== actor.id || (old.changes as Record<string, unknown> | null)?.requestHash !== hash) throw new BookingError(409, "RequestKeyConflict");
  const reservation = await tx.reservation.findUnique({ where: { id: old.targetId } });
  if (!reservation) throw new BookingError(409, "RequestKeyConflict");
  const changes = old.changes as Record<string, unknown>;
  return { reservationId: reservation.id, version: changes.resultVersion as number, status: changes.resultStatus as string, replayed: true };
}
function auditActor(actor: Actor) { return { actorType: actor.role, ...(actor.role === "MEMBER" ? { actorMemberId: actor.id } : actor.role === "STAFF" ? { actorStaffId: actor.id } : { actorAdminId: actor.id }) } as const; }
function checkQuote(input: Selection, calculated: { totalDurationMinutes: number; totalPriceYen: number }) {
  if (input.quote.totalDurationMinutes !== calculated.totalDurationMinutes || input.quote.totalPriceYen !== calculated.totalPriceYen) throw new BookingError(409, "SelectionChanged");
}
async function validateSelection(tx: Prisma.TransactionClient, input: Selection, now: Date, excludeReservationId?: string, exception = false) {
  if (Date.parse(input.startsAt) <= now.getTime()) throw new BookingError(409, "Unavailable");
  await lockCatalog(tx, input);
  let evaluated;
    try { evaluated = await revalidateAtSave(tx, input, input.startsAt, now, { excludeReservationId, ignoreBookingWindow: exception, roomId: input.roomId, therapistId: input.therapistId }); }
  catch (error) { if (error instanceof Error && (/Invalid|Inactive|exceeds|Use a valid/.test(error.message))) throw new BookingError(409, "SelectionChanged"); throw error; }
  checkQuote(input, evaluated.totals);
  if (!evaluated.assignment) throw new BookingError(409, "Unavailable");
  const [treatment, options, room, therapist] = await Promise.all([
    tx.treatment.findUniqueOrThrow({ where: { id: input.treatmentId } }),
    tx.option.findMany({ where: { id: { in: input.optionIds } } }),
    tx.room.findUniqueOrThrow({ where: { id: evaluated.assignment.roomId } }),
    tx.therapist.findUniqueOrThrow({ where: { id: evaluated.assignment.therapistId } }),
  ]);
  return { ...evaluated, treatment, options, room, therapist };
}
function reservationData(input: Selection, member: Awaited<ReturnType<typeof bookableMember>>, data: Awaited<ReturnType<typeof validateSelection>>) {
  const assignment = data.assignment!;
  return {
    memberId: member.id, treatmentId: data.treatment.id, roomId: data.room.id, therapistId: data.therapist.id,
    memberLastNameSnapshot: member.lastName, memberFirstNameSnapshot: member.firstName, memberEmailSnapshot: member.email, memberPhoneNumberSnapshot: member.phoneNumber,
    treatmentNameSnapshot: data.treatment.name, treatmentDurationMinutesSnapshot: data.treatment.durationMinutes, treatmentPriceYenSnapshot: data.treatment.priceYen,
    roomNameSnapshot: data.room.name, therapistNameSnapshot: data.therapist.name,
    businessDate: parseBusinessDate(input.date), startsAt: new Date(assignment.startsAt), treatmentEndsAt: new Date(assignment.treatmentEndsAt), occupiesUntil: new Date(assignment.occupiesUntil),
    totalDurationMinutes: data.totals.totalDurationMinutes, totalPriceYen: data.totals.totalPriceYen, slotCount: data.totals.slotCount, notes: input.notes,
  };
}
async function writeDetails(tx: Prisma.TransactionClient, reservationId: string, input: Selection, data: Awaited<ReturnType<typeof validateSelection>>) {
  await tx.reservationOption.createMany({ data: data.options.map(option => ({ reservationId, optionId: option.id, optionNameSnapshot: option.name, optionDurationMinutesSnapshot: option.durationMinutes, optionPriceYenSnapshot: option.priceYen })) });
  await tx.reservationSlot.createMany({ data: data.assignment!.slotStartsAt.map(slotStartsAt => ({ reservationId, roomId: data.room.id, therapistId: data.therapist.id, slotStartsAt: new Date(slotStartsAt) })) });
}

export async function createReservation(request: Request, value: unknown) {
  const input = parseCreate(value);
  checkMutationOrigin(request);
  const hash = digest(input);
  const deliveryIds: string[] = [];
  const result = await getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const actor = await authorize(tx, request, "RESERVATION_CREATE", false);
    if (actor.role === "MEMBER" && input.memberId !== undefined || actor.role !== "MEMBER" && !input.memberId) throw new BookingError(400, "InvalidInput");
    await lockBookingState(tx);
    if (actor.role !== "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CREATED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    const member = await bookableMember(tx, actor.role === "MEMBER" ? actor.id : input.memberId!);
    await confirmMemberSession(tx, actor);
    if (actor.role === "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CREATED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    const now = await clock(tx);
    const data = await validateSelection(tx, input, now);
    const id = randomUUID();
    const reservation = await tx.reservation.create({ data: { id, ...reservationData(input, member, data) } });
    await writeDetails(tx, id, input, data);
    await tx.auditLog.create({ data: { requestKey: input.requestKey, ...auditActor(actor), action: "RESERVATION_CREATED", targetType: "Reservation", targetId: id, changes: { requestHash: hash, resultVersion: 1, resultStatus: "CONFIRMED" } } });
    if (actor.role === "MEMBER") deliveryIds.push(...await queueReservationConfirmation(tx, reservation, data.options));
    return { reservationId: id, version: 1, status: "CONFIRMED" as const, replayed: false };
  }, { timeout: 20_000 });
  for (const deliveryId of deliveryIds) dispatchMailAfterResponse(deliveryId);
  return result;
}

export async function changeReservation(request: Request, id: string, value: unknown) {
  if (!uuid.test(id)) return invalid();
  const input = parseChange(value);
  checkMutationOrigin(request);
  const hash = digest({ id, ...input });
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const actor = await authorize(tx, request, "RESERVATION_UPDATE", input.storeException);
    if (actor.role === "MEMBER" && input.roomId) throw new BookingError(403, "Forbidden");
    await lockBookingState(tx);
    if (actor.role !== "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CHANGED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    const old = await tx.reservation.findUnique({ where: { id } });
    if (!old) throw new BookingError(404, "NotFound");
    if (actor.role === "MEMBER" && old.memberId !== actor.id) throw new BookingError(403, "Forbidden");
    const member = await bookableMember(tx, old.memberId);
    await confirmMemberSession(tx, actor);
    if (actor.role === "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CHANGED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.reservation.findUniqueOrThrow({ where: { id } });
    if (current.status !== "CONFIRMED" || current.version !== input.expectedVersion) throw new BookingError(409, "VersionConflict");
    const now = await clock(tx);
    if (!input.storeException) {
      const deadline = await cancellationDeadline(tx, current.businessDate.toISOString().slice(0, 10));
      if (deadline === null || now.getTime() > deadline) throw new BookingError(409, "DeadlinePassed");
    }
    const data = await validateSelection(tx, input, now, id, input.storeException);
    await tx.reservationSlot.deleteMany({ where: { reservationId: id } });
    await tx.reservationOption.deleteMany({ where: { reservationId: id } });
    const updated = await tx.reservation.updateMany({ where: { id, version: input.expectedVersion, status: "CONFIRMED" }, data: { ...reservationData(input, member, data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new BookingError(409, "VersionConflict");
    await writeDetails(tx, id, input, data);
    await tx.auditLog.create({ data: { requestKey: input.requestKey, ...auditActor(actor), action: "RESERVATION_CHANGED", targetType: "Reservation", targetId: id, changes: { requestHash: hash, beforeVersion: input.expectedVersion, resultVersion: input.expectedVersion + 1, resultStatus: "CONFIRMED", storeException: input.storeException, exceptionReason: input.exceptionReason } } });
    await resolveNoticesAfterReservation(tx, id, actor, "changed");
    return { reservationId: id, version: input.expectedVersion + 1, status: "CONFIRMED" as const, replayed: false };
  }, { timeout: 20_000 });
}

export async function cancelReservation(request: Request, id: string, value: unknown) {
  if (!uuid.test(id)) return invalid();
  const input = parseCancel(value);
  checkMutationOrigin(request);
  const hash = digest({ id, ...input });
  const deliveryIds: string[] = [];
  const result = await getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const actor = await authorize(tx, request, "RESERVATION_CANCEL", input.storeException);
    await lockBookingState(tx);
    if (actor.role !== "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CANCELLED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    const old = await tx.reservation.findUnique({ where: { id } });
    if (!old) throw new BookingError(404, "NotFound");
    if (actor.role === "MEMBER" && old.memberId !== actor.id) throw new BookingError(403, "Forbidden");
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${old.memberId}::uuid FOR UPDATE`;
    await confirmMemberSession(tx, actor);
    if (actor.role === "MEMBER") {
      const repeated = await replay(tx, actor, "RESERVATION_CANCELLED", input.requestKey, hash);
      if (repeated) return repeated;
    }
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.reservation.findUniqueOrThrow({ where: { id } });
    if (current.status !== "CONFIRMED" || current.version !== input.expectedVersion) throw new BookingError(409, "VersionConflict");
    const now = await clock(tx);
    if (!input.storeException) {
      const deadline = await cancellationDeadline(tx, current.businessDate.toISOString().slice(0, 10));
      if (deadline === null || now.getTime() > deadline) throw new BookingError(409, "DeadlinePassed");
    }
    const audit = await tx.auditLog.create({ data: { requestKey: input.requestKey, ...auditActor(actor), action: "RESERVATION_CANCELLED", targetType: "Reservation", targetId: id, changes: { requestHash: hash, beforeVersion: input.expectedVersion, resultVersion: input.expectedVersion + 1, resultStatus: "CANCELLED", storeException: input.storeException, exceptionReason: input.exceptionReason } } });
    const updated = await tx.reservation.updateMany({ where: { id, status: "CONFIRMED", version: input.expectedVersion }, data: { status: "CANCELLED", version: { increment: 1 }, cancelledAt: now, cancellationKind: input.storeException ? "STORE_EXCEPTION" : "NORMAL", cancellationReason: input.storeException ? input.exceptionReason : input.reason, cancellationAuditId: audit.id } });
    if (updated.count !== 1) throw new BookingError(409, "VersionConflict");
    await tx.reservationSlot.deleteMany({ where: { reservationId: id } });
    await resolveNoticesAfterReservation(tx, id, actor, "cancelled");
    if (actor.role === "MEMBER") {
      const cancelled = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { options: { orderBy: { optionId: "asc" } } } });
      deliveryIds.push(...await queueReservationCancellation(tx, cancelled, cancelled.options.map(option => ({ name: option.optionNameSnapshot }))));
    }
    return { reservationId: id, version: input.expectedVersion + 1, status: "CANCELLED" as const, replayed: false };
  }, { timeout: 20_000 });
  for (const deliveryId of deliveryIds) dispatchMailAfterResponse(deliveryId);
  return result;
}

export function bookingFailure(error: unknown) {
  const prismaCode = error && typeof error === "object" && "code" in error ? error.code : null;
  const status = error instanceof BookingError || error instanceof StoreAccessError || error instanceof StoreInputError ? error.status : ["P2002", "P2034", "P2014"].includes(String(prismaCode)) ? 409 : 503;
  return Response.json({ error: error instanceof BookingError ? error.code : status === 400 ? "InvalidInput" : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
}
