import "server-only";

import { randomUUID } from "node:crypto";
import { StaffPermissionKey } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { emailKey, validPassword } from "@/lib/auth/policy";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { checkMutationOrigin, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = new Set<string>(Object.values(StaffPermissionKey));

export async function createStaff(request: Request, input: unknown) {
  checkMutationOrigin(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StoreInputError(400);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["email", "displayName", "password"].includes(key))) throw new StoreInputError(400);
  const email = emailKey(record.email);
  const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";
  if (!email || !displayName || displayName.length > 100 || !validPassword(record.password)) throw new StoreInputError(400);
  const passwordHash = await hashPassword(record.password);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, "STAFF_CREATE");
    if (await tx.staffAccount.findUnique({ where: { emailKey: email }, select: { id: true } })) throw new StoreInputError(409);
    const created = await tx.staffAccount.create({ data: { email, emailKey: email, displayName, passwordHash }, select: { id: true } });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: "STAFF_CREATED", targetType: "StaffAccount", targetId: created.id, changes: { initialPermissionCount: 0 } } });
    return created;
  });
}

export async function changeStaffPermission(request: Request, staffId: string, input: unknown) {
  checkMutationOrigin(request);
  if (!uuid.test(staffId)) throw new StoreInputError(400);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StoreInputError(400);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["permission", "enabled"].includes(key)) || typeof record.permission !== "string" || !keys.has(record.permission) || typeof record.enabled !== "boolean") throw new StoreInputError(400);
  const permission = record.permission as StaffPermissionKey;
  const enabled = record.enabled;
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, "STAFF_PERMISSION_MANAGE");
    await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${staffId}::uuid FOR UPDATE`;
    if (!await tx.staffAccount.findUnique({ where: { id: staffId }, select: { id: true } })) throw new StoreInputError(404);
    const where = { staffId_permission: { staffId, permission } };
    const existing = await tx.staffPermission.findUnique({ where, select: { staffId: true } });
    if (enabled === !!existing) return { changed: false, enabled };
    if (enabled) await tx.staffPermission.create({ data: { staffId, permission, grantedByAdminId: claims.principalId } });
    else await tx.staffPermission.delete({ where });
    await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: "ADMIN", actorAdminId: claims.principalId, action: enabled ? "STAFF_PERMISSION_GRANTED" : "STAFF_PERMISSION_REVOKED", targetType: "StaffAccount", targetId: staffId, changes: { permission } } });
    return { changed: true, enabled };
  });
}
