import type { Prisma } from "../src/generated/prisma/client";

const time = (hour: number) => new Date(`1970-01-01T${String(hour).padStart(2, "0")}:00:00Z`);
export const initialScheduleDate = new Date("2026-09-01T00:00:00Z");

/** Development sample agreed with the user; never replace an existing plan/revision. */
export async function seedSchedules(tx: Prisma.TransactionClient, therapistIds: readonly string[]) {
  await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  for (let i = 0; i <= therapistIds.length; i++) {
    const kind = i === 0 ? "BUSINESS_WEEKLY" : "THERAPIST_BREAK";
    const therapistId = i === 0 ? null : therapistIds[i - 1];
    if (await tx.schedulePlan.findFirst({ where: { kind, therapistId, effectiveDate: initialScheduleDate } })) continue;
    const plan = await tx.schedulePlan.create({ data: { kind, therapistId, effectiveDate: initialScheduleDate } });
    const audit = await tx.auditLog.create({ data: {
      requestKey: crypto.randomUUID(), actorType: "SYSTEM", action: "schedule.seed", targetType: "SchedulePlan", targetId: plan.id,
    } });
    let businessScheduleId: string | undefined;
    let therapistScheduleId: string | undefined;
    if (i === 0) {
      const schedule = await tx.businessSchedule.create({ data: { days: { create: Array.from({ length: 7 }, (_, weekday) => ({
        weekday, isOpen: weekday !== 0, opensAt: weekday === 0 ? null : time(9), closesAt: time(18),
      })) } } });
      businessScheduleId = schedule.id;
    } else {
      const schedule = await tx.therapistSchedule.create({ data: { therapistId: therapistId!, breaks: { create: Array.from({ length: 7 }, (_, weekday) => ({
        weekday, startsAt: weekday === 0 ? null : time(11 + i), endsAt: weekday === 0 ? null : time(12 + i),
      })) } } });
      therapistScheduleId = schedule.id;
    }
    await tx.scheduleSettingChange.create({ data: { planId: plan.id, revision: 1, action: "CREATE", auditId: audit.id,
      reason: "開発用初期設定（月〜土曜営業・日曜休業）", businessScheduleId, therapistScheduleId } });
  }
}
