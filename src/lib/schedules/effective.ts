import "server-only";
import type { Prisma } from "../../generated/prisma/client";
import { parseBusinessDate } from "./calendar";

/** Call inside one repeatable-read transaction when composing multiple reads.
 * Write paths must additionally participate in the shared store lock (Story 4.2).
 */
export async function getEffectiveBusinessDay(tx: Prisma.TransactionClient, value: string, excludedPlanId?: string) {
  const date = parseBusinessDate(value);
  const weekday = date.getUTCDay();
  const daily = await tx.schedulePlan.findFirst({
    where: { kind: "BUSINESS_DATE", effectiveDate: date },
    include: { changes: { orderBy: { revision: "desc" }, take: 1, include: { businessOverride: true } } },
  });
  const override = daily?.changes[0];
  if (override && daily?.id !== excludedPlanId && override.action !== "CANCEL") {
    if (!override.businessOverride) throw new Error("Incomplete daily business setting.");
    return { planId: daily!.id, revision: override.revision, auditId: override.auditId, source: "DAILY" as const,
      effectiveDate: daily!.effectiveDate, isOpen: override.businessOverride.isOpen,
      opensAt: override.businessOverride.opensAt, closesAt: override.businessOverride.closesAt };
  }
  const plans = await tx.schedulePlan.findMany({
    where: { kind: "BUSINESS_WEEKLY", effectiveDate: { lte: date } },
    orderBy: { effectiveDate: "desc" },
    include: { changes: { orderBy: { revision: "desc" }, take: 1, include: { businessSchedule: { include: { days: true } } } } },
  });
  for (const plan of plans) {
    if (plan.id === excludedPlanId) continue;
    const latest = plan.changes[0];
    if (!latest || latest.action === "CANCEL") continue;
    const day = latest.businessSchedule?.days.find(day => day.weekday === weekday);
    if (!day) throw new Error("Incomplete weekly business setting.");
    return { planId: plan.id, revision: latest.revision, auditId: latest.auditId, source: "WEEKLY" as const,
      effectiveDate: plan.effectiveDate, isOpen: day.isOpen, opensAt: day.opensAt, closesAt: day.closesAt };
  }
  return null; // No implicit 09:00-18:00 fallback.
}

export async function getEffectiveTherapistBreak(tx: Prisma.TransactionClient, therapistId: string, value: string, excludedPlanId?: string) {
  const date = parseBusinessDate(value);
  const plans = await tx.schedulePlan.findMany({
    where: { kind: "THERAPIST_BREAK", therapistId, effectiveDate: { lte: date } },
    orderBy: { effectiveDate: "desc" },
    include: { changes: { orderBy: { revision: "desc" }, take: 1, include: { therapistSchedule: { include: { breaks: true } } } } },
  });
  for (const plan of plans) {
    if (plan.id === excludedPlanId) continue;
    const latest = plan.changes[0];
    if (!latest || latest.action === "CANCEL") continue;
    const rest = latest.therapistSchedule?.breaks.find(rest => rest.weekday === date.getUTCDay());
    if (!rest) throw new Error("Incomplete therapist break setting.");
    return { planId: plan.id, revision: latest.revision, auditId: latest.auditId, effectiveDate: plan.effectiveDate,
      startsAt: rest.startsAt, endsAt: rest.endsAt }; // Both null means explicitly unconfigured.
  }
  return null;
}

/** Pre-filter for booking assignment. Call within the same repeatable-read
 * transaction as availability checks; occupancy and capacity are checked later.
 */
export async function getEffectiveScheduleForDate(tx: Prisma.TransactionClient, value: string) {
  const business = await getEffectiveBusinessDay(tx, value);
  const therapists = await tx.therapist.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const people = await Promise.all(therapists.map(async (therapist) => {
    const rest = await getEffectiveTherapistBreak(tx, therapist.id, value);
    const assignable = Boolean(business?.isOpen && business.opensAt && rest?.startsAt && rest.endsAt && rest.startsAt >= business.opensAt && rest.endsAt <= business.closesAt);
    return { ...therapist, rest, assignable };
  }));
  return { business, therapists: people };
}

export async function getAssignableTherapistsForDate(tx: Prisma.TransactionClient, value: string) {
  const effective = await getEffectiveScheduleForDate(tx, value);
  return effective.therapists.filter((person) => person.assignable).map(({ id, name }) => ({ id, name }));
}
