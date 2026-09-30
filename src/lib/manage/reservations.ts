import "server-only";

import type { ReservationStatus } from "@/generated/prisma/enums";
import { ReservationStatus as statuses } from "@/generated/prisma/enums";
import { requireStoreAction } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";
import { parseBusinessDate, tokyoBusinessDate } from "@/lib/schedules/calendar";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReservationFilters = { date: string; roomId: string; therapistId: string; status: ReservationStatus | ""; view: "list" | "calendar" };

export function parseReservationFilters(input: Record<string, string | string[] | undefined>): ReservationFilters {
  const one = (key: string) => {
    const value = input[key];
    if (Array.isArray(value)) throw new Error("InvalidFilter");
    return value ?? "";
  };
  const date = one("date") || tokyoBusinessDate(new Date());
  try { parseBusinessDate(date); } catch { throw new Error("InvalidFilter"); }
  const roomId = one("roomId");
  const therapistId = one("therapistId");
  const status = one("status");
  const view = one("view") || "list";
  if ((roomId && !uuid.test(roomId)) || (therapistId && !uuid.test(therapistId)) || (status && !Object.values(statuses).includes(status as ReservationStatus)) || (view !== "list" && view !== "calendar")) throw new Error("InvalidFilter");
  return { date, roomId, therapistId, status: status as ReservationStatus | "", view };
}

export async function listStoreReservations(filters: ReservationFilters) {
  await requireStoreAction("STORE_VIEW");
  const db = getPrisma();
  const [rooms, therapists, reservations] = await Promise.all([
    db.room.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.therapist.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.reservation.findMany({
      where: { businessDate: parseBusinessDate(filters.date), ...(filters.roomId ? { roomId: filters.roomId } : {}), ...(filters.therapistId ? { therapistId: filters.therapistId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      select: { id: true, status: true, startsAt: true, treatmentEndsAt: true, occupiesUntil: true, memberLastNameSnapshot: true, memberFirstNameSnapshot: true, treatmentNameSnapshot: true, roomId: true, roomNameSnapshot: true, therapistId: true, therapistNameSnapshot: true },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return { rooms, therapists, reservations };
}

export async function getStoreReservation(id: string) {
  await requireStoreAction("STORE_VIEW");
  if (!uuid.test(id)) return null;
  return getPrisma().reservation.findUnique({ where: { id }, select: {
    id: true, memberId: true, status: true, businessDate: true, startsAt: true, treatmentEndsAt: true, occupiesUntil: true,
    actualStartedAt: true, actualCompletedAt: true, cancelledAt: true, cancellationKind: true, cancellationReason: true,
    memberLastNameSnapshot: true, memberFirstNameSnapshot: true, memberEmailSnapshot: true, memberPhoneNumberSnapshot: true,
    treatmentNameSnapshot: true, treatmentDurationMinutesSnapshot: true, treatmentPriceYenSnapshot: true,
    totalDurationMinutes: true, totalPriceYen: true, slotCount: true, roomNameSnapshot: true, therapistNameSnapshot: true,
    notes: true, options: { select: { optionId: true, optionNameSnapshot: true, optionDurationMinutesSnapshot: true, optionPriceYenSnapshot: true }, orderBy: { optionId: "asc" } },
  } });
}
