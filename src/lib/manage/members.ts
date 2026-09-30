import "server-only";

import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { withdrawalReviewToken } from "@/lib/member/withdraw-review";

export async function memberManagementAccess() {
  const access = await getStoreCapabilities();
  const canForce = access.principal.role === "ADMIN" || access.permissions.includes("MEMBER_FORCE_WITHDRAW");
  const canDelete = access.principal.role === "ADMIN" || access.permissions.includes("MEMBER_DELETE");
  const canRestore = access.principal.role === "ADMIN" || access.permissions.includes("MEMBER_RESTORE");
  if (!canForce && !canDelete && !canRestore) throw new StoreAccessError(403);
  return { canForce, canDelete, canRestore, isAdmin: access.principal.role === "ADMIN" };
}

export async function managedMemberDetail(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  await memberManagementAccess();
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const member = await tx.member.findUnique({ where: { id }, select: { id: true, email: true, lastName: true, firstName: true, phoneNumber: true, status: true, isDeleted: true, version: true, firstActivatedAt: true, createdAt: true, updatedAt: true } });
    if (!member) return null;
    const [confirmed, grouped, lifecycle] = await Promise.all([
      tx.reservation.findMany({ where: { memberId: id, status: "CONFIRMED" }, select: { id: true, version: true, startsAt: true, treatmentNameSnapshot: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] }),
      tx.reservation.groupBy({ by: ["status"], where: { memberId: id }, _count: { _all: true } }),
      tx.memberLifecycleEvent.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, reason: true, createdAt: true } }),
    ]);
    return { member, confirmed, grouped, lifecycle, reviewToken: withdrawalReviewToken(id, member.version, confirmed) };
  }, { isolationLevel: "RepeatableRead" });
}
