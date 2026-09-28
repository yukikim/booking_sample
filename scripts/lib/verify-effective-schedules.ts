import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client, DatabaseError } from "pg";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { seedDevelopment, seedIds } from "../../prisma/seed-data";
import { getEffectiveBusinessDay, getEffectiveTherapistBreak } from "../../src/lib/schedules/effective";

export async function verifyEffectiveSchedules(db: Client, prisma: PrismaClient, checked: Set<string>) {
  let passed = 0;
  const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
  async function insert(table: string, row: Record<string, unknown>) {
    const keys = Object.keys(row);
    await db.query(`INSERT INTO ${q(table)} (${keys.map(q).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
  }
  async function reject(action: () => Promise<unknown>, code: string, constraint?: string) {
    await db.query("SAVEPOINT schedule_case");
    try {
      await assert.rejects(action, (error: unknown) => {
        const e = error as DatabaseError;
        assert.equal(e.code, code);
        if (constraint) { assert.equal(e.constraint, constraint); checked.add(constraint); }
        return true;
      });
      passed++;
    } finally { await db.query("ROLLBACK TO SAVEPOINT schedule_case"); await db.query("RELEASE SAVEPOINT schedule_case"); }
  }
  const baseline = await prisma.schedulePlan.findFirstOrThrow({ where: { kind: "BUSINESS_WEEKLY" }, include: { changes: true } });
  const initial = baseline.changes[0];
  const initialRest = await prisma.schedulePlan.findFirstOrThrow({ where: { kind: "THERAPIST_BREAK" }, include: { changes: true } });
  assert.equal(await prisma.scheduleSettingChange.count(), 3);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-09-28"))?.closesAt.getUTCHours(), 18);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-09-27"))?.isOpen, false);
  assert.equal(await getEffectiveBusinessDay(prisma, "2026-08-31"), null);
  assert.equal((await getEffectiveTherapistBreak(prisma, seedIds.therapists[0], "2026-09-28"))?.startsAt?.getUTCHours(), 12);
  assert.equal((await getEffectiveTherapistBreak(prisma, seedIds.therapists[1], "2026-09-28"))?.startsAt?.getUTCHours(), 13);
  assert.equal(await getEffectiveTherapistBreak(prisma, randomUUID(), "2026-09-28"), null);
  passed += 7;

  // Raw SQL exercises constraints inside a rolled-back fixture transaction.
  await db.query("BEGIN");
  try {
    const schedule = randomUUID(), rest = randomUUID(), override = randomUUID(), audit = randomUUID(), plan = randomUUID();
    await insert("BusinessSchedule", { id: schedule });
    await insert("TherapistSchedule", { id: rest, therapistId: seedIds.therapists[0] });
    await insert("AuditLog", { id: audit, requestKey: randomUUID(), actorType: "SYSTEM", action: "schedule.test", targetType: "SchedulePlan", targetId: plan });
    await insert("SchedulePlan", { id: plan, kind: "BUSINESS_WEEKLY", effectiveDate: "2026-10-01" });
    await reject(() => insert("BusinessDay", { scheduleId: schedule, weekday: 1, isOpen: true, opensAt: "09:00", closesAt: "24:00" }), "23514", "BusinessDay_closingLimit_check");
    await reject(() => insert("TherapistBreak", { scheduleId: rest, weekday: 1, startsAt: "23:00", endsAt: "24:00" }), "23514", "TherapistBreak_closingLimit_check");
    await reject(() => insert("SchedulePlan", { id: randomUUID(), kind: "THERAPIST_BREAK", effectiveDate: "2026-10-01" }), "23514", "SchedulePlan_scope_check");
    await reject(() => insert("BusinessDateOverride", { id: override, isOpen: false, closesAt: "24:00" }), "23514", "BusinessDateOverride_hours_check");
    await reject(() => db.query('UPDATE "StoreSettingState" SET version=0 WHERE id=1'), "23514", "StoreSettingState_singleton_check");
    const change = { id: randomUUID(), planId: plan, revision: 1, action: "CREATE", auditId: audit, reason: "test", businessScheduleId: schedule };
    await reject(() => insert("ScheduleSettingChange", change), "23514", "ScheduleSettingChange_snapshot_guard");
    for (let weekday = 0; weekday < 7; weekday++) await insert("BusinessDay", { scheduleId: schedule, weekday, isOpen: true, opensAt: "09:00", closesAt: "18:00" });
    await reject(() => insert("ScheduleSettingChange", { ...change, revision: 0 }), "23514", "ScheduleSettingChange_revision_check");
    await reject(() => insert("ScheduleSettingChange", { ...change, reason: " " }), "23514", "ScheduleSettingChange_content_check");
    await reject(() => insert("ScheduleSettingChange", { ...change, previousId: initial.id, revision: 2, action: "REVISE" }), "23514", "ScheduleSettingChange_chain_guard");
    await reject(() => insert("ScheduleSettingChange", { ...change, planId: baseline.id, previousId: initial.id, revision: 3, action: "REVISE" }), "23514", "ScheduleSettingChange_chain_guard");
    await reject(() => insert("ScheduleSettingChange", { ...change, businessScheduleId: null, therapistScheduleId: rest }), "23514", "ScheduleSettingChange_snapshot_guard");
    await insert("ScheduleSettingChange", change);
    await reject(() => insert("SchedulePlan", { id: randomUUID(), kind: "BUSINESS_WEEKLY", effectiveDate: "2026-10-01" }), "23505");
    await reject(() => insert("SchedulePlan", { id: randomUUID(), kind: "THERAPIST_BREAK", effectiveDate: initialRest.effectiveDate, therapistId: initialRest.therapistId }), "23505");
    for (const sql of [
      'UPDATE "SchedulePlan" SET "effectiveDate"=\'2026-12-01\'',
      'DELETE FROM "ScheduleSettingChange"',
      'UPDATE "BusinessSchedule" SET "createdAt"=now()',
      'DELETE FROM "BusinessDay"',
      'UPDATE "TherapistSchedule" SET "createdAt"=now()',
      'UPDATE "TherapistBreak" SET "startsAt"=NULL,"endsAt"=NULL',
    ]) await reject(() => db.query(sql), "55000");
    await reject(() => insert("BusinessDay", { scheduleId: initial.businessScheduleId, weekday: 0, isOpen: false, closesAt: "18:00" }), "55000");
    const currentVersion = (await db.query('SELECT version FROM "StoreSettingState" WHERE id=1')).rows[0].version;
    assert.equal((await db.query('UPDATE "StoreSettingState" SET version=version+1 WHERE id=1 AND version=$1', [currentVersion])).rowCount, 1);
    assert.equal((await db.query('UPDATE "StoreSettingState" SET version=version+1 WHERE id=1 AND version=$1', [currentVersion])).rowCount, 0);
    passed += 2;
  } finally { await db.query("ROLLBACK"); }

  // Prisma operations deliberately use the adapter's schema (default search_path is public).
  const time = (hour: number) => new Date(`1970-01-01T${String(hour).padStart(2, "0")}:00:00Z`);
  async function weekly(hour: number) {
    return prisma.businessSchedule.create({ data: { days: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, isOpen: true, opensAt: time(9), closesAt: time(hour) })) } } });
  }
  async function change(planId: string, content: { businessScheduleId?: string; businessOverrideId?: string; therapistScheduleId?: string } | null) {
    const previous = await prisma.scheduleSettingChange.findFirst({ where: { planId }, orderBy: { revision: "desc" } });
    const audit = await prisma.auditLog.create({ data: { requestKey: randomUUID(), actorType: "SYSTEM", action: "schedule.test", targetType: "SchedulePlan", targetId: planId } });
    return prisma.scheduleSettingChange.create({ data: { planId, revision: (previous?.revision ?? 0) + 1, previousId: previous?.id,
      action: content === null ? "CANCEL" : previous ? "REVISE" : "CREATE", reason: "test", auditId: audit.id, ...content } });
  }
  const middle = await prisma.schedulePlan.create({ data: { kind: "BUSINESS_WEEKLY", effectiveDate: new Date("2026-10-01") } });
  await change(middle.id, { businessScheduleId: (await weekly(17)).id });
  const future = await prisma.schedulePlan.create({ data: { kind: "BUSINESS_WEEKLY", effectiveDate: new Date("2026-11-01") } });
  await change(future.id, { businessScheduleId: (await weekly(16)).id });
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-09-30"))?.closesAt.getUTCHours(), 18);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-01"))?.closesAt.getUTCHours(), 17);
  await change(middle.id, { businessScheduleId: (await weekly(15)).id });
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-17"))?.closesAt.getUTCHours(), 15);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-11-01"))?.closesAt.getUTCHours(), 16);
  const daily = await prisma.schedulePlan.create({ data: { kind: "BUSINESS_DATE", effectiveDate: new Date("2026-10-17") } });
  const closed = await prisma.businessDateOverride.create({ data: { isOpen: false, closesAt: time(14) } });
  await change(daily.id, { businessOverrideId: closed.id });
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-17"))?.source, "DAILY");
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-17"))?.isOpen, false);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-18"))?.source, "WEEKLY");
  await change(daily.id, null);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-17"))?.closesAt.getUTCHours(), 15);
  await change(middle.id, null);
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-10-17"))?.closesAt.getUTCHours(), 18); // Not 17: canceled plan never revives.
  assert.equal((await getEffectiveBusinessDay(prisma, "2026-11-01"))?.closesAt.getUTCHours(), 16);
  const restPlan = await prisma.schedulePlan.create({ data: { kind: "THERAPIST_BREAK", therapistId: seedIds.therapists[0], effectiveDate: new Date("2026-10-01") } });
  const unset = await prisma.therapistSchedule.create({ data: { therapistId: seedIds.therapists[0], breaks: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday })) } } });
  await change(restPlan.id, { therapistScheduleId: unset.id });
  assert.equal((await getEffectiveTherapistBreak(prisma, seedIds.therapists[0], "2026-10-17"))?.startsAt, null);
  assert.equal((await getEffectiveTherapistBreak(prisma, seedIds.therapists[1], "2026-10-17"))?.startsAt?.getUTCHours(), 13);
  await change(restPlan.id, null);
  assert.equal((await getEffectiveTherapistBreak(prisma, seedIds.therapists[0], "2026-10-17"))?.startsAt?.getUTCHours(), 12);
  await change(baseline.id, null);
  const changesBeforeSeed = await prisma.scheduleSettingChange.count();
  await seedDevelopment(prisma);
  assert.equal(await prisma.scheduleSettingChange.count(), changesBeforeSeed);
  assert.equal(await getEffectiveBusinessDay(prisma, "2026-10-17"), null);
  passed += 15;
  await db.query("BEGIN");
  try {
    await reject(() => db.query('UPDATE "BusinessDateOverride" SET "closesAt"=\'16:00\' WHERE id=$1', [closed.id]), "55000");
    const latest = await prisma.scheduleSettingChange.findFirstOrThrow({ where: { planId: middle.id }, orderBy: { revision: "desc" } });
    await reject(() => insert("ScheduleSettingChange", { id: randomUUID(), planId: middle.id, revision: latest.revision + 1, action: "REVISE", previousId: latest.id, auditId: initial.auditId, reason: "test", businessScheduleId: initial.businessScheduleId }), "23514", "ScheduleSettingChange_chain_guard");
  } finally { await db.query("ROLLBACK"); }
  return passed;
}
