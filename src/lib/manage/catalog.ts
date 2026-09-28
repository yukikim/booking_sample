import "server-only";

import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { requireStoreAction } from "@/lib/auth/permissions";
import { checkMutationOrigin, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";

export type CatalogKind = "treatments" | "options";
export type CatalogItem = { id: string; name: string; durationMinutes: number; priceYen: number; isActive: boolean; updatedAt: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function catalogKind(value: string): CatalogKind {
  if (value !== "treatments" && value !== "options") throw new StoreInputError(404);
  return value;
}

function numberField(value: unknown, minimum: number, maximum: number): number {
  let parsed: number;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed)) throw new StoreInputError(400);
    parsed = Number(trimmed);
  } else if (typeof value === "number") parsed = value;
  else throw new StoreInputError(400);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new StoreInputError(400);
  return parsed;
}

function fields(input: unknown, allowed: string[], kind: CatalogKind) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StoreInputError(400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new StoreInputError(400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new StoreInputError(400);
  return { name, durationMinutes: numberField(body.durationMinutes, kind === "treatments" ? 1 : 0, 1380), priceYen: numberField(body.priceYen, 0, 1000000) };
}

function version(input: unknown) {
  if (typeof input !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input)) throw new StoreInputError(400);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input) throw new StoreInputError(400);
  return input;
}

function serialize(item: { id: string; name: string; durationMinutes: number; priceYen: number; isActive: boolean; updatedAt: Date }): CatalogItem {
  return { id: item.id, name: item.name, durationMinutes: item.durationMinutes, priceYen: item.priceYen, isActive: item.isActive, updatedAt: item.updatedAt.toISOString() };
}

export async function listCatalog() {
  await requireStoreAction("STORE_VIEW");
  const db = getPrisma();
  const [treatments, options] = await Promise.all([
    db.treatment.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
    db.option.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
  ]);
  return { treatments: treatments.map(serialize), options: options.map(serialize) };
}

export async function createCatalog(request: Request, kind: CatalogKind, input: unknown) {
  checkMutationOrigin(request);
  const data = fields(input, ["name", "durationMinutes", "priceYen"], kind);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, kind === "treatments" ? "TREATMENT_CREATE" : "OPTION_CREATE");
    const created = kind === "treatments" ? await tx.treatment.create({ data }) : await tx.option.create({ data });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: kind === "treatments" ? "TREATMENT_CREATED" : "OPTION_CREATED", targetType: kind === "treatments" ? "Treatment" : "Option", targetId: created.id, changes: { after: { ...data, isActive: true } } } });
    return serialize(created);
  });
}

export async function changeCatalog(request: Request, kind: CatalogKind, id: string, input: unknown) {
  checkMutationOrigin(request);
  if (!uuid.test(id) || !input || typeof input !== "object" || Array.isArray(input)) throw new StoreInputError(400);
  const body = input as Record<string, unknown>;
  const operation = body.operation;
  if (operation !== "update" && operation !== "disable") throw new StoreInputError(400);
  const expected = version(body.updatedAt);
  const data = operation === "update" ? fields(input, ["operation", "updatedAt", "name", "durationMinutes", "priceYen"], kind) : undefined;
  if (operation === "disable" && Object.keys(body).some((key) => !["operation", "updatedAt"].includes(key))) throw new StoreInputError(400);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const action = kind === "treatments" ? (operation === "update" ? "TREATMENT_UPDATE" : "TREATMENT_DISABLE") : (operation === "update" ? "OPTION_UPDATE" : "OPTION_DISABLE");
    const claims = await requireStoreMutation(tx, request, action);
    if (kind === "treatments") await tx.$queryRaw`SELECT id FROM "Treatment" WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Option" WHERE id = ${id}::uuid FOR UPDATE`;
    const old = kind === "treatments" ? await tx.treatment.findUnique({ where: { id } }) : await tx.option.findUnique({ where: { id } });
    if (!old) throw new StoreInputError(404);
    if (old.updatedAt.toISOString() !== expected) throw new StoreInputError(409);
    if (!old.isActive) throw new StoreInputError(409);
    if (operation === "update" && data && old.name === data.name && old.durationMinutes === data.durationMinutes && old.priceYen === data.priceYen) return serialize(old);
    const now = new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1));
    const update = operation === "disable" ? { isActive: false, updatedAt: now } : { ...data!, updatedAt: now };
    const saved = kind === "treatments" ? await tx.treatment.update({ where: { id }, data: update }) : await tx.option.update({ where: { id }, data: update });
    const before = { name: old.name, durationMinutes: old.durationMinutes, priceYen: old.priceYen, isActive: old.isActive };
    const after = { name: saved.name, durationMinutes: saved.durationMinutes, priceYen: saved.priceYen, isActive: saved.isActive };
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: kind === "treatments" ? (operation === "update" ? "TREATMENT_UPDATED" : "TREATMENT_DISABLED") : (operation === "update" ? "OPTION_UPDATED" : "OPTION_DISABLED"), targetType: kind === "treatments" ? "Treatment" : "Option", targetId: id, changes: { before, after } } });
    return serialize(saved);
  });
}
