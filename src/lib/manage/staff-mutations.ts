import "server-only";

import { randomUUID } from "node:crypto";
import { getToken } from "next-auth/jwt";
import { StaffPermissionKey } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { authEnvironment } from "@/lib/auth/config";
import { StoreAccessError } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { claimsFrom, emailKey, validPassword } from "@/lib/auth/policy";
import { resolveSession } from "@/lib/auth/session";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";

export class StaffInputError extends Error {
  constructor(readonly status: 400 | 404 | 409) { super("InvalidStaffInput"); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = new Set<string>(Object.values(StaffPermissionKey));

export function checkMutationOrigin(request: Request) {
  if (request.headers.get("origin") !== authEnvironment().origin) throw new StoreAccessError(403);
}

export async function readStaffBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new StaffInputError(400);
  if (Number(request.headers.get("content-length")) > 4096) throw new StaffInputError(400);
  const body = await request.text();
  if (body.length > 4096) throw new StaffInputError(400);
  try { return JSON.parse(body); } catch { throw new StaffInputError(400); }
}

async function signedClaims(request: Request) {
  const env = authEnvironment();
  const cookie = request.headers.get("cookie") ?? "";
  const token = await getToken({ req: new Request(env.origin, { headers: { cookie } }), secret: env.secret, secureCookie: env.secure });
  const claims = claimsFrom(token);
  if (!claims) throw new StoreAccessError(401);
  return claims;
}

/** AppSession and principal locks serialize signout, deactivation and grant changes with writes. */
async function authorize(tx: Prisma.TransactionClient, claims: NonNullable<Awaited<ReturnType<typeof signedClaims>>>, action: "STAFF_CREATE" | "STAFF_PERMISSION_MANAGE") {
  await tx.$queryRaw`SELECT id FROM "AppSession" WHERE id = ${claims.sid}::uuid FOR UPDATE`;
  if (claims.role === "ADMIN") await tx.$queryRaw`SELECT id FROM "AdminAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
  if (!await resolveSession(claims, new Date(), tx)) throw new StoreAccessError(401);
  if (claims.role === "ADMIN") return;
  if (action === "STAFF_PERMISSION_MANAGE") throw new StoreAccessError(403);
  const grant = await tx.staffPermission.findUnique({ where: { staffId_permission: { staffId: claims.principalId, permission: "STAFF_CREATE" } } });
  if (!grant) throw new StoreAccessError(403);
}

export async function createStaff(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const claims = await signedClaims(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StaffInputError(400);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["email", "displayName", "password"].includes(key))) throw new StaffInputError(400);
  const email = emailKey(record.email);
  const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";
  if (!email || !displayName || displayName.length > 100 || !validPassword(record.password)) throw new StaffInputError(400);
  const passwordHash = await hashPassword(record.password);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    await authorize(tx, claims, "STAFF_CREATE");
    if (await tx.staffAccount.findUnique({ where: { emailKey: email }, select: { id: true } })) throw new StaffInputError(409);
    const created = await tx.staffAccount.create({ data: { email, emailKey: email, displayName, passwordHash }, select: { id: true } });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: "STAFF_CREATED", targetType: "StaffAccount", targetId: created.id, changes: { initialPermissionCount: 0 } } });
    return created;
  });
}

export async function changeStaffPermission(request: Request, staffId: string, input: unknown) {
  checkMutationOrigin(request);
  const claims = await signedClaims(request);
  if (!uuid.test(staffId)) throw new StaffInputError(400);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StaffInputError(400);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["permission", "enabled"].includes(key)) || typeof record.permission !== "string" || !keys.has(record.permission) || typeof record.enabled !== "boolean") throw new StaffInputError(400);
  const permission = record.permission as StaffPermissionKey;
  const enabled = record.enabled;
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    await authorize(tx, claims, "STAFF_PERMISSION_MANAGE");
    await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${staffId}::uuid FOR UPDATE`;
    if (!await tx.staffAccount.findUnique({ where: { id: staffId }, select: { id: true } })) throw new StaffInputError(404);
    const where = { staffId_permission: { staffId, permission } };
    const existing = await tx.staffPermission.findUnique({ where, select: { staffId: true } });
    if (enabled === !!existing) return { changed: false, enabled };
    if (enabled) await tx.staffPermission.create({ data: { staffId, permission, grantedByAdminId: claims.principalId } });
    else await tx.staffPermission.delete({ where });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: "ADMIN", actorAdminId: claims.principalId, action: enabled ? "STAFF_PERMISSION_GRANTED" : "STAFF_PERMISSION_REVOKED", targetType: "StaffAccount", targetId: staffId, changes: { permission } } });
    return { changed: true, enabled };
  });
}

export function staffMutationFailure(error: unknown) {
  const status = error instanceof StoreAccessError || error instanceof StaffInputError ? error.status : (error && typeof error === "object" && "code" in error && error.code === "P2002" ? 409 : 503);
  const message = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 400 ? "InvalidInput" : status === 404 ? "NotFound" : status === 409 ? "Conflict" : "TemporarilyUnavailable";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
