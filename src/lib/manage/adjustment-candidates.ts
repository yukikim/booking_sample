import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { evaluateAvailability } from "@/lib/booking/availability";

export async function adjustmentCandidates(tx: Prisma.TransactionClient, reservation: { id: string; status: string; startsAt: Date; businessDate: Date; treatmentId: string; options: { optionId: string }[] }, now = new Date()) {
  if (reservation.status !== "CONFIRMED") return [];
  const date = reservation.businessDate.toISOString().slice(0, 10);
  try {
    const result = await evaluateAvailability(tx, { date, treatmentId: reservation.treatmentId, optionIds: reservation.options.map(row => row.optionId) }, now, { excludeReservationId: reservation.id, ignoreBookingWindow: true });
    return result.times.filter(row => Math.abs(Date.parse(row.startsAt) - reservation.startsAt.getTime()) <= 2 * 60 * 60_000);
  } catch (error) {
    if (error instanceof Error && /Inactive|Invalid|missing|exceeds/.test(error.message)) return [];
    throw error;
  }
}
