import "server-only";

import { requireBookableMember } from "@/lib/auth/member";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { cancellationDeadline } from "./deadline";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = {
  id: true, version: true, status: true, startsAt: true, treatmentEndsAt: true,
  businessDate: true, treatmentNameSnapshot: true, totalDurationMinutes: true,
  totalPriceYen: true, cancelledAt: true,
} as const;

export async function listMemberReservations() {
  const { memberId } = await requireBookableMember();
  const rows = await getPrisma().reservation.findMany({ where: { memberId }, select: fields, orderBy: [{ startsAt: "desc" }, { id: "desc" }] });
  return rows.map(row => ({ ...row, startsAt: row.startsAt.toISOString(), treatmentEndsAt: row.treatmentEndsAt.toISOString(), businessDate: row.businessDate.toISOString().slice(0, 10), cancelledAt: row.cancelledAt?.toISOString() ?? null }));
}

export async function getMemberReservation(id: string) {
  const { memberId } = await requireBookableMember();
  if (!uuid.test(id)) return null;
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const row = await tx.reservation.findFirst({ where: { id, memberId }, select: {
      ...fields, occupiesUntil: true, roomNameSnapshot: true, therapistNameSnapshot: true,
      treatmentDurationMinutesSnapshot: true, treatmentPriceYenSnapshot: true,
      memberLastNameSnapshot: true, memberFirstNameSnapshot: true, memberEmailSnapshot: true,
      memberPhoneNumberSnapshot: true, notes: true, cancellationReason: true, cancellationKind: true,
      options: { select: { optionId: true, optionNameSnapshot: true, optionDurationMinutesSnapshot: true, optionPriceYenSnapshot: true }, orderBy: { optionId: "asc" } },
    } });
    if (!row) return null;
    const deadline = row.status === "CONFIRMED" ? await cancellationDeadline(tx, row.businessDate.toISOString().slice(0, 10)) : null;
    return {
      ...row, startsAt: row.startsAt.toISOString(), treatmentEndsAt: row.treatmentEndsAt.toISOString(),
      occupiesUntil: row.occupiesUntil.toISOString(), businessDate: row.businessDate.toISOString().slice(0, 10),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancellationDeadline: deadline === null ? null : new Date(deadline).toISOString(),
      canCancel: row.status === "CONFIRMED" && deadline !== null && Date.now() <= deadline,
    };
  }, { isolationLevel: "RepeatableRead" });
}
