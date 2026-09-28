import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getEffectiveBusinessDay, getEffectiveTherapistBreak } from "./effective";
import { parseBusinessDate } from "./calendar";

export type WeeklyDay = { weekday: number; isOpen: boolean; opensAt: number | null; closesAt: number };
export type BreakDay = { weekday: number; startsAt: number | null; endsAt: number | null };
export type ScheduleSetting =
  | { kind: "BUSINESS_WEEKLY"; days: WeeklyDay[] }
  | { kind: "BUSINESS_DATE"; isOpen: boolean; opensAt: number | null; closesAt: number }
  | { kind: "THERAPIST_BREAK"; therapistId: string; breaks: BreakDay[] };
export type ScheduleProposal = { effectiveDate: Date; setting: ScheduleSetting; cancelPlanId?: undefined; kind?: ScheduleSetting["kind"]; therapistId?: string | null } | { effectiveDate: Date; setting?: undefined; cancelPlanId: string; kind: ScheduleSetting["kind"]; therapistId: string | null };
export type ImpactRow = {
  reservationId: string;
  reservationVersion: number;
  businessDate: string;
  startsAt: string;
  before: string | null;
  after: string | null;
  cutoffBefore: string | null;
  cutoffAfter: string | null;
};

function minutes(value: Date, businessDate: string) {
  const tokyoMidnight = parseBusinessDate(businessDate).getTime() - 9 * 60 * 60_000;
  return (value.getTime() - tokyoMidnight) / 60_000;
}

function unavailable(
  business: { isOpen: boolean; opensAt: Date | null; closesAt: Date } | null,
  rest: { startsAt: Date | null; endsAt: Date | null } | null,
  startsAt: Date,
  occupiesUntil: Date,
  businessDate: string,
  roomActive: boolean,
  therapistActive: boolean,
) {
  if (!roomActive || !therapistActive) return "RESOURCE_UNAVAILABLE";
  if (!business?.isOpen || !business.opensAt) return "BUSINESS_CLOSED";
  const start = minutes(startsAt, businessDate);
  const end = minutes(occupiesUntil, businessDate);
  if (start < business.opensAt.getUTCHours() * 60 || end > business.closesAt.getUTCHours() * 60) return "OUTSIDE_BUSINESS_HOURS";
  if (!rest?.startsAt || !rest.endsAt) return "BREAK_UNSET";
  if (start < rest.endsAt.getUTCHours() * 60 && end > rest.startsAt.getUTCHours() * 60) return "OVERLAPS_BREAK";
  return null;
}

async function nextEffectiveDate(tx: Prisma.TransactionClient, proposal: ScheduleProposal) {
  const kind = proposal.setting?.kind ?? proposal.kind;
  if (kind === "BUSINESS_DATE") return new Date(proposal.effectiveDate.getTime() + 86_400_000);
  const plans = await tx.schedulePlan.findMany({
    where: {
      kind,
      therapistId: proposal.setting?.kind === "THERAPIST_BREAK" ? proposal.setting.therapistId : "therapistId" in proposal ? proposal.therapistId : null,
      effectiveDate: { gt: proposal.effectiveDate },
    },
    orderBy: { effectiveDate: "asc" },
    include: { changes: { orderBy: { revision: "desc" }, take: 1, select: { action: true } } },
  });
  return plans.find((plan) => plan.changes[0]?.action !== "CANCEL")?.effectiveDate ?? null;
}

/** Compare the saved schedule with one proposed change for every still-active reservation in its effective interval. */
export async function analyzeScheduleImpact(tx: Prisma.TransactionClient, proposal: ScheduleProposal) {
  const until = await nextEffectiveDate(tx, proposal);
  const kind = proposal.setting?.kind ?? proposal.kind;
  const affectedTherapistId = proposal.setting?.kind === "THERAPIST_BREAK" ? proposal.setting.therapistId : "therapistId" in proposal ? proposal.therapistId : null;
  const reservationUntil = until && kind !== "THERAPIST_BREAK" ? new Date(until.getTime() + 86_400_000) : until;
  const reservations = await tx.reservation.findMany({
    where: {
      businessDate: { gte: proposal.effectiveDate, ...(reservationUntil ? { lt: reservationUntil } : {}) },
      ...(kind === "THERAPIST_BREAK" && affectedTherapistId ? { therapistId: affectedTherapistId } : {}),
      OR: [{ status: "IN_PROGRESS" }, { status: "CONFIRMED", occupiesUntil: { gt: new Date() } }],
    },
    include: { room: { select: { isActive: true } }, therapist: { select: { isActive: true } } },
    orderBy: [{ businessDate: "asc" }, { startsAt: "asc" }, { id: "asc" }],
  });
  const rows: ImpactRow[] = [];
  for (const reservation of reservations) {
    const date = reservation.businessDate.toISOString().slice(0, 10);
    const weekday = reservation.businessDate.getUTCDay();
    const currentBusiness = await getEffectiveBusinessDay(tx, date);
    const currentRest = await getEffectiveTherapistBreak(tx, reservation.therapistId, date);
    let nextBusiness: typeof currentBusiness | { isOpen: boolean; opensAt: Date | null; closesAt: Date } = currentBusiness;
    let nextRest: typeof currentRest | { startsAt: Date | null; endsAt: Date | null } = currentRest;
    const setting = proposal.setting;
    const appliesToReservation = !until || reservation.businessDate < until;
    if (proposal.cancelPlanId && appliesToReservation) {
      if (kind === "THERAPIST_BREAK") nextRest = await getEffectiveTherapistBreak(tx, reservation.therapistId, date, proposal.cancelPlanId);
      else nextBusiness = await getEffectiveBusinessDay(tx, date, proposal.cancelPlanId);
    } else if (setting?.kind === "BUSINESS_DATE" && appliesToReservation) {
      nextBusiness = { isOpen: setting.isOpen, opensAt: setting.opensAt === null ? null : new Date(Date.UTC(1970, 0, 1, setting.opensAt)), closesAt: new Date(Date.UTC(1970, 0, 1, setting.closesAt)) };
    } else if (setting?.kind === "BUSINESS_WEEKLY" && appliesToReservation && currentBusiness?.source !== "DAILY") {
      const day = setting.days[weekday];
      nextBusiness = { isOpen: day.isOpen, opensAt: day.opensAt === null ? null : new Date(Date.UTC(1970, 0, 1, day.opensAt)), closesAt: new Date(Date.UTC(1970, 0, 1, day.closesAt)) };
    } else if (setting?.kind === "THERAPIST_BREAK" && appliesToReservation) {
      const rest = setting.breaks[weekday];
      nextRest = { startsAt: rest.startsAt === null ? null : new Date(Date.UTC(1970, 0, 1, rest.startsAt)), endsAt: rest.endsAt === null ? null : new Date(Date.UTC(1970, 0, 1, rest.endsAt)) };
    }
    const before = unavailable(currentBusiness, currentRest, reservation.startsAt, reservation.occupiesUntil, date, reservation.room.isActive, reservation.therapist.isActive);
    const after = unavailable(nextBusiness, nextRest, reservation.startsAt, reservation.occupiesUntil, date, reservation.room.isActive, reservation.therapist.isActive);
    // The booking cutoff uses the prior calendar day's closing time, even when that day is closed.
    const previous = new Date(reservation.businessDate.getTime() - 86_400_000).toISOString().slice(0, 10);
    const oldCutoff = await getEffectiveBusinessDay(tx, previous);
    let newCutoff: typeof oldCutoff | { closesAt: Date } = oldCutoff;
    const cutoffApplies = previous >= proposal.effectiveDate.toISOString().slice(0, 10) && (!until || previous < until.toISOString().slice(0, 10));
    if (proposal.cancelPlanId && kind !== "THERAPIST_BREAK" && cutoffApplies) {
      newCutoff = await getEffectiveBusinessDay(tx, previous, proposal.cancelPlanId);
    } else if (proposal.setting?.kind === "BUSINESS_WEEKLY" && cutoffApplies && oldCutoff?.source !== "DAILY") {
      newCutoff = { closesAt: new Date(Date.UTC(1970, 0, 1, proposal.setting.days[parseBusinessDate(previous).getUTCDay()].closesAt)) };
    } else if (proposal.setting?.kind === "BUSINESS_DATE" && cutoffApplies && previous === proposal.effectiveDate.toISOString().slice(0, 10)) {
      newCutoff = { closesAt: new Date(Date.UTC(1970, 0, 1, proposal.setting.closesAt)) };
    }
    const cutoffBefore = oldCutoff ? `${previous}T${String(oldCutoff.closesAt.getUTCHours()).padStart(2, "0")}:00+09:00` : null;
    const cutoffAfter = newCutoff ? `${previous}T${String(newCutoff.closesAt.getUTCHours()).padStart(2, "0")}:00+09:00` : null;
    if (before !== after || cutoffBefore !== cutoffAfter) rows.push({ reservationId: reservation.id, reservationVersion: reservation.version, businessDate: date, startsAt: reservation.startsAt.toISOString(), before, after, cutoffBefore, cutoffAfter });
  }
  return rows;
}
