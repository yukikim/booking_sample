import "server-only";

import { createHash } from "node:crypto";
import { MemberAccessError, requireBookableMember } from "@/lib/auth/member";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";

export function withdrawalReviewToken(memberId: string, version: number, reservations: { id: string; version: number }[]) {
  return createHash("sha256").update(JSON.stringify({ memberId, version, reservations: reservations.map(row => [row.id, row.version]).sort(([a], [b]) => String(a).localeCompare(String(b))) })).digest("hex");
}

export async function getWithdrawalPreview() {
  const { memberId } = await requireBookableMember();
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const member = await tx.member.findUnique({ where: { id: memberId }, select: { version: true, status: true, isDeleted: true } });
    if (!member || member.status !== "ACTIVE" || member.isDeleted) throw new MemberAccessError(403);
    const [confirmed, inProgressCount, completedCount, cancelledCount] = await Promise.all([
      tx.reservation.findMany({ where: { memberId, status: "CONFIRMED" }, select: { id: true, version: true, startsAt: true, treatmentNameSnapshot: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] }),
      tx.reservation.count({ where: { memberId, status: "IN_PROGRESS" } }),
      tx.reservation.count({ where: { memberId, status: "COMPLETED" } }),
      tx.reservation.count({ where: { memberId, status: "CANCELLED" } }),
    ]);
    return {
      expectedVersion: member.version,
      reviewToken: withdrawalReviewToken(memberId, member.version, confirmed),
      confirmed: confirmed.map(row => ({ id: row.id, startsAt: row.startsAt.toISOString(), treatmentName: row.treatmentNameSnapshot })),
      inProgressCount, completedCount, cancelledCount,
    };
  }, { isolationLevel: "RepeatableRead" });
}
