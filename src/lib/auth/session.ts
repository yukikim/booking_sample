import "server-only";
import { getPrisma } from "../prisma";
import { adminEnvironment } from "./config";
import { claimsFrom } from "./policy";
import type { Prisma } from "@/generated/prisma/client";

export async function resolveSession(value: unknown, now = new Date(), db: Prisma.TransactionClient = getPrisma()) {
  const claims = claimsFrom(value);
  if (!claims || claims.absoluteExpiry <= now.getTime()) return null;
  const row = await db.appSession.findUnique({ where: { id: claims.sid }, include: { staff: { select: { isActive: true, authVersion: true } }, admin: { select: { isActive: true } } } });
  if (!row || row.revokedAt || row.expiresAt <= now || row.expiresAt.getTime() !== claims.absoluteExpiry || row.principalType !== claims.role || row.authVersion !== claims.authVersion) return null;
  if (claims.role === "STAFF") {
    if (row.staffId !== claims.principalId || !row.staff?.isActive || row.staff.authVersion !== claims.authVersion) return null;
  } else if (row.adminId !== claims.principalId || !row.admin?.isActive || adminEnvironment().version !== claims.authVersion) return null;
  return claims;
}
export async function revokeSession(value: unknown) {
  const claims = claimsFrom(value);
  if (!claims) return;
  await getPrisma().appSession.updateMany({ where: { id: claims.sid, principalType: claims.role, authVersion: claims.authVersion, ...(claims.role === "ADMIN" ? { adminId: claims.principalId } : { staffId: claims.principalId }), revokedAt: null }, data: { revokedAt: new Date() } });
}
