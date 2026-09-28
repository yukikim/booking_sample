import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { requireStoreAction } from "@/lib/auth/permissions";
import { checkMutationOrigin, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { classifySettingDate, parseBusinessDate, tokyoBusinessDate } from "./calendar";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type WeeklyDay = { weekday: number; isOpen: boolean; opensAt: number | null; closesAt: number };
type BreakDay = { weekday: number; startsAt: number | null; endsAt: number | null };
type SettingInput = { kind: "BUSINESS_WEEKLY"; days: WeeklyDay[] } | { kind: "BUSINESS_DATE"; isOpen: boolean; opensAt: number | null; closesAt: number } | { kind: "THERAPIST_BREAK"; therapistId: string; breaks: BreakDay[] };
const atHour = (hour: number) => new Date(`1970-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`);
const hourText = (value: Date | null) => value === null ? null : `${String(value.getUTCHours()).padStart(2, "0")}:00`;

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreInputError(400);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new StoreInputError(400);
  return row;
}
function hour(value: unknown, min: number, max: number): number {
  if (typeof value !== "string" || !/^\d\d:00$/.test(value)) throw new StoreInputError(400);
  const parsed = Number(value.slice(0, 2));
  if (parsed < min || parsed > max) throw new StoreInputError(400);
  return parsed;
}
function business(value: unknown): { isOpen: boolean; opensAt: number | null; closesAt: number } {
  const row = value as Record<string, unknown>;
  if (typeof row.isOpen !== "boolean") throw new StoreInputError(400);
  const closesAt = hour(row.closesAt, 1, 23);
  if (!row.isOpen) {
    if (row.opensAt !== null) throw new StoreInputError(400);
    return { isOpen: false, opensAt: null, closesAt };
  }
  const opensAt = hour(row.opensAt, 0, 22);
  if (opensAt >= closesAt) throw new StoreInputError(400);
  return { isOpen: true, opensAt, closesAt };
}
function weekdays(value: unknown, type: "business" | "break") {
  if (!Array.isArray(value) || value.length !== 7) throw new StoreInputError(400);
  const seen = new Set<number>();
  const rows = value.map((entry) => {
    const row = record(entry, type === "business" ? ["weekday", "isOpen", "opensAt", "closesAt"] : ["weekday", "startsAt", "endsAt"]);
    if (!Number.isInteger(row.weekday) || (row.weekday as number) < 0 || (row.weekday as number) > 6 || seen.has(row.weekday as number)) throw new StoreInputError(400);
    const weekday = row.weekday as number;
    seen.add(weekday);
    if (type === "business") return { weekday, ...business(row) } as WeeklyDay;
    if (row.startsAt === null && row.endsAt === null) return { weekday, startsAt: null, endsAt: null } as BreakDay;
    const startsAt = hour(row.startsAt, 0, 22);
    const endsAt = hour(row.endsAt, 1, 23);
    if (endsAt !== startsAt + 1) throw new StoreInputError(400);
    return { weekday, startsAt, endsAt } as BreakDay;
  });
  return rows.sort((a, b) => a.weekday - b.weekday);
}
function parseInput(value: unknown) {
  const row = record(value, ["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "days", "isOpen", "opensAt", "closesAt", "therapistId", "breaks"]);
  if (typeof row.effectiveDate !== "string") throw new StoreInputError(400);
  let effectiveDate: Date;
  try { effectiveDate = parseBusinessDate(row.effectiveDate); } catch { throw new StoreInputError(400); }
  if (!Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1) throw new StoreInputError(400);
  if (row.expectedRevision !== undefined && (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 1)) throw new StoreInputError(400);
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (!reason || [...reason].length > 1000) throw new StoreInputError(400);
  let setting: SettingInput;
  if (row.kind === "BUSINESS_WEEKLY") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "days"].includes(key))) throw new StoreInputError(400);
    setting = { kind: row.kind, days: weekdays(row.days, "business") as WeeklyDay[] };
  } else if (row.kind === "BUSINESS_DATE") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "isOpen", "opensAt", "closesAt"].includes(key))) throw new StoreInputError(400);
    setting = { kind: row.kind, ...business(row) };
  } else if (row.kind === "THERAPIST_BREAK") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "therapistId", "breaks"].includes(key)) || typeof row.therapistId !== "string" || !uuid.test(row.therapistId)) throw new StoreInputError(400);
    setting = { kind: row.kind, therapistId: row.therapistId, breaks: weekdays(row.breaks, "break") as BreakDay[] };
  } else throw new StoreInputError(400);
  return { effectiveDate, effectiveDateText: row.effectiveDate, expectedVersion: row.expectedVersion as number, expectedRevision: row.expectedRevision as number | undefined, reason, setting };
}

async function latestWeekly(tx: Prisma.TransactionClient, date: Date) {
  const plans = await tx.schedulePlan.findMany({ where: { kind: "BUSINESS_WEEKLY", effectiveDate: { lte: date } }, orderBy: { effectiveDate: "desc" }, include: { changes: { orderBy: { revision: "desc" }, take: 1, include: { businessSchedule: { include: { days: true } } } } } });
  for (const plan of plans) {
    const latest = plan.changes[0];
    if (!latest || latest.action === "CANCEL") continue;
    if (!latest.businessSchedule || latest.businessSchedule.days.length !== 7) throw new Error("Incomplete weekly setting.");
    return latest.businessSchedule.days;
  }
  return null;
}
async function latestBreak(tx: Prisma.TransactionClient, therapistId: string, date: Date) {
  const plans = await tx.schedulePlan.findMany({ where: { kind: "THERAPIST_BREAK", therapistId, effectiveDate: { lte: date } }, orderBy: { effectiveDate: "desc" }, include: { changes: { orderBy: { revision: "desc" }, take: 1, include: { therapistSchedule: { include: { breaks: true } } } } } });
  for (const plan of plans) {
    const latest = plan.changes[0];
    if (!latest || latest.action === "CANCEL") continue;
    if (!latest.therapistSchedule || latest.therapistSchedule.breaks.length !== 7) throw new Error("Incomplete therapist setting.");
    return latest.therapistSchedule.breaks;
  }
  return null;
}

export async function listManagedSchedules() {
  await requireStoreAction("STORE_VIEW");
  const db = getPrisma();
  const state = await db.storeSettingState.findUnique({ where: { id: 1 }, select: { version: true } });
  const today = parseBusinessDate(tokyoBusinessDate(new Date()));
  const therapists = await db.therapist.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } });
  const weekly = await latestWeekly(db, today);
  const breaks = await Promise.all(therapists.map(async (therapist) => ({ ...therapist, days: (await latestBreak(db, therapist.id, today))?.sort((a, b) => a.weekday - b.weekday).map((day) => ({ weekday: day.weekday, startsAt: hourText(day.startsAt), endsAt: hourText(day.endsAt) })) ?? null })));
  return { version: state?.version ?? 1, weekly: weekly?.sort((a, b) => a.weekday - b.weekday).map((day) => ({ weekday: day.weekday, isOpen: day.isOpen, opensAt: hourText(day.opensAt), closesAt: hourText(day.closesAt) })) ?? null, therapists: breaks };
}

export async function saveManagedSchedule(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const parsed = parseInput(input);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const action = parsed.setting.kind === "THERAPIST_BREAK" ? "THERAPIST_BREAK_MANAGE" : "BUSINESS_SETTING_MANAGE";
    const claims = await requireStoreMutation(tx, request, action);
    await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
    const state = await tx.storeSettingState.findUniqueOrThrow({ where: { id: 1 } });
    if (state.version !== parsed.expectedVersion) throw new StoreInputError(409);
    let mode;
    try { mode = classifySettingDate(parsed.effectiveDateText, new Date()); } catch { throw new StoreInputError(400); }
    if (mode.mode === "NEAR_TERM") throw new StoreInputError(409, "ImpactReviewPending");
    const dateFilter = parsed.setting.kind === "BUSINESS_DATE" ? { equals: parsed.effectiveDate } : { gte: parsed.effectiveDate };
    const affected = await tx.reservation.findFirst({ where: { businessDate: dateFilter, ...(parsed.setting.kind === "THERAPIST_BREAK" ? { therapistId: parsed.setting.therapistId } : {}), OR: [{ status: "IN_PROGRESS" }, { status: "CONFIRMED", occupiesUntil: { gt: new Date() } }] }, select: { id: true } });
    if (affected) throw new StoreInputError(409, "AffectedReservations");
    if (parsed.setting.kind === "THERAPIST_BREAK") {
      const therapist = await tx.therapist.findUnique({ where: { id: parsed.setting.therapistId }, select: { isActive: true } });
      if (!therapist?.isActive) throw new StoreInputError(404);
      const weekly = await latestWeekly(tx, parsed.effectiveDate);
      if (!weekly) throw new StoreInputError(409);
      for (const rest of parsed.setting.breaks) {
        if (rest.startsAt === null) continue;
        const day = weekly.find((entry) => entry.weekday === rest.weekday);
        if (!day?.isOpen || !day.opensAt || rest.startsAt < day.opensAt.getUTCHours() || rest.endsAt! > day.closesAt.getUTCHours()) throw new StoreInputError(400);
      }
    } else if (parsed.setting.kind === "BUSINESS_WEEKLY") {
      const therapists = await tx.therapist.findMany({ where: { isActive: true }, select: { id: true } });
      for (const therapist of therapists) {
        const breaks = await latestBreak(tx, therapist.id, parsed.effectiveDate);
        if (!breaks) continue;
        for (const rest of breaks) {
          if (!rest.startsAt) continue;
          const day = parsed.setting.days.find((entry) => entry.weekday === rest.weekday)!;
          if (!day.isOpen || rest.startsAt.getUTCHours() < day.opensAt! || rest.endsAt!.getUTCHours() > day.closesAt) throw new StoreInputError(400);
        }
      }
    }
    const therapistId = parsed.setting.kind === "THERAPIST_BREAK" ? parsed.setting.therapistId : null;
    let plan = await tx.schedulePlan.findFirst({ where: { kind: parsed.setting.kind, therapistId, effectiveDate: parsed.effectiveDate } });
    let previous;
    if (plan) {
      previous = await tx.scheduleSettingChange.findFirst({ where: { planId: plan.id }, orderBy: { revision: "desc" } });
      if (!previous || previous.action === "CANCEL") throw new StoreInputError(409);
      if (parsed.expectedRevision === undefined) throw new StoreInputError(409, "ExistingPlanReviewPending");
      if (parsed.expectedRevision !== previous.revision) throw new StoreInputError(409);
    } else {
      if (parsed.expectedRevision !== undefined) throw new StoreInputError(409);
      plan = await tx.schedulePlan.create({ data: { kind: parsed.setting.kind, therapistId, effectiveDate: parsed.effectiveDate } });
    }
    let content: { businessScheduleId?: string; businessOverrideId?: string; therapistScheduleId?: string };
    if (parsed.setting.kind === "BUSINESS_WEEKLY") {
      const created = await tx.businessSchedule.create({ data: { days: { create: parsed.setting.days.map((day) => ({ weekday: day.weekday, isOpen: day.isOpen, opensAt: day.opensAt === null ? null : atHour(day.opensAt), closesAt: atHour(day.closesAt) })) } } });
      content = { businessScheduleId: created.id };
    } else if (parsed.setting.kind === "BUSINESS_DATE") {
      const created = await tx.businessDateOverride.create({ data: { isOpen: parsed.setting.isOpen, opensAt: parsed.setting.opensAt === null ? null : atHour(parsed.setting.opensAt), closesAt: atHour(parsed.setting.closesAt) } });
      content = { businessOverrideId: created.id };
    } else {
      const created = await tx.therapistSchedule.create({ data: {
        therapistId: parsed.setting.therapistId,
        breaks: { create: parsed.setting.breaks.map((day) => ({
          weekday: day.weekday,
          startsAt: day.startsAt === null ? null : atHour(day.startsAt),
          endsAt: day.endsAt === null ? null : atHour(day.endsAt),
        })) },
      } });
      content = { therapistScheduleId: created.id };
    }
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: previous ? "SCHEDULE_REVISED" : "SCHEDULE_CREATED", targetType: "SchedulePlan", targetId: plan.id, changes: { kind: parsed.setting.kind, effectiveDate: parsed.effectiveDateText, revision: (previous?.revision ?? 0) + 1 } } });
    const change = await tx.scheduleSettingChange.create({ data: { planId: plan.id, revision: (previous?.revision ?? 0) + 1, previousId: previous?.id, action: previous ? "REVISE" : "CREATE", reason: parsed.reason, auditId: audit.id, ...content } });
    await tx.storeSettingState.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    return { planId: plan.id, revision: change.revision, version: state.version + 1, mode: mode.mode };
  });
}
