import "server-only";

import { randomUUID } from "node:crypto";
import { requireStoreAction } from "@/lib/auth/permissions";
import { checkMutationOrigin, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { issueReviewToken, matchesReviewToken } from "@/lib/schedules/review-token";

export type ResourceKind = "rooms" | "therapists";
export type ResourceItem = { id: string; name: string; isActive: boolean; updatedAt: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resourceKind(value: string): ResourceKind {
  if (value !== "rooms" && value !== "therapists") throw new StoreInputError(404);
  return value;
}

function bodyRecord(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StoreInputError(400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new StoreInputError(400);
  return body;
}

function nameField(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || [...name].length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new StoreInputError(400);
  return name;
}

function version(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new StoreInputError(400);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new StoreInputError(400);
  return value;
}

function serialize(row: { id: string; name: string; isActive: boolean; updatedAt: Date }): ResourceItem {
  return { id: row.id, name: row.name, isActive: row.isActive, updatedAt: row.updatedAt.toISOString() };
}

export async function listResources() {
  await requireStoreAction("STORE_VIEW");
  const db = getPrisma();
  const [rooms, therapists] = await Promise.all([
    db.room.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
    db.therapist.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
  ]);
  return { rooms: rooms.map(serialize), therapists: therapists.map(serialize) };
}

export async function createResource(request: Request, kind: ResourceKind, input: unknown) {
  checkMutationOrigin(request);
  const name = nameField(bodyRecord(input, ["name"]).name);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, kind === "rooms" ? "ROOM_CREATE" : "THERAPIST_CREATE");
    const created = kind === "rooms" ? await tx.room.create({ data: { name } }) : await tx.therapist.create({ data: { name } });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: kind === "rooms" ? "ROOM_CREATED" : "THERAPIST_CREATED", targetType: kind === "rooms" ? "Room" : "Therapist", targetId: created.id, changes: { after: { name, isActive: true } } } });
    return serialize(created);
  });
}

export async function changeResource(request: Request, kind: ResourceKind, id: string, input: unknown) {
  checkMutationOrigin(request);
  if (!uuid.test(id)) throw new StoreInputError(400);
  const body = bodyRecord(input, ["operation", "updatedAt", "name", "reviewToken"]);
  const operation = body.operation;
  if (operation !== "update" && operation !== "disable" && operation !== "preview-disable") throw new StoreInputError(400);
  if (operation !== "update" && "name" in body || operation === "update" && "reviewToken" in body || operation === "preview-disable" && "reviewToken" in body) throw new StoreInputError(400);
  const expected = version(body.updatedAt);
  const name = operation === "update" ? nameField(body.name) : undefined;
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const action = kind === "rooms" ? (operation === "update" ? "ROOM_UPDATE" : "ROOM_DISABLE") : (operation === "update" ? "THERAPIST_UPDATE" : "THERAPIST_DISABLE");
    const claims = await requireStoreMutation(tx, request, action);
    if (operation === "disable") {
      await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
      await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
    }
    if (kind === "rooms") await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Therapist" WHERE id = ${id}::uuid FOR UPDATE`;
    const old = kind === "rooms" ? await tx.room.findUnique({ where: { id } }) : await tx.therapist.findUnique({ where: { id } });
    if (!old) throw new StoreInputError(404);
    if (old.updatedAt.toISOString() !== expected || !old.isActive) throw new StoreInputError(409);
    if (operation === "update" && old.name === name) return serialize(old);
    let affected: { id: string; version: number; businessDate: Date; startsAt: Date }[] = [];
    if (operation !== "update") {
      affected = await tx.reservation.findMany({ where: { ...(kind === "rooms" ? { roomId: id } : { therapistId: id }), OR: [{ status: "IN_PROGRESS" }, { status: "CONFIRMED", occupiesUntil: { gt: new Date() } }] }, select: { id: true, version: true, businessDate: true, startsAt: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
      const subject = { actor: `${claims.role}:${claims.principalId}`, kind, id, updatedAt: expected, affected: affected.map((row) => ({ id: row.id, version: row.version, startsAt: row.startsAt.toISOString() })) };
      if (operation === "preview-disable") return { affected: affected.map((row) => ({ reservationId: row.id, businessDate: row.businessDate.toISOString().slice(0, 10), startsAt: row.startsAt.toISOString() })), reviewToken: issueReviewToken(subject) };
      if (!matchesReviewToken(body.reviewToken, subject)) throw new StoreInputError(409, "ReviewRequired");
    }
    const updatedAt = new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1));
    const data = operation === "update" ? { name: name!, updatedAt } : { isActive: false, updatedAt };
    const saved = kind === "rooms" ? await tx.room.update({ where: { id }, data }) : await tx.therapist.update({ where: { id }, data });
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: kind === "rooms" ? (operation === "update" ? "ROOM_UPDATED" : "ROOM_DISABLED") : (operation === "update" ? "THERAPIST_UPDATED" : "THERAPIST_DISABLED"), targetType: kind === "rooms" ? "Room" : "Therapist", targetId: id, changes: { before: { name: old.name, isActive: old.isActive }, after: { name: saved.name, isActive: saved.isActive }, affected: affected.length } } });
    if (operation === "disable") {
      for (const row of affected) await tx.reservationChangeNotice.create({ data: { reservationId: row.id, changeAuditId: audit.id, reservationVersion: row.version, reason: "RESOURCE_UNAVAILABLE", proposedChange: { kind, resourceId: id } } });
      await tx.storeSettingState.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    }
    return serialize(saved);
  });
}
