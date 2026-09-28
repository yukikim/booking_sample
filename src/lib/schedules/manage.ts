import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { requireStoreAction } from "@/lib/auth/permissions";
import { checkMutationOrigin, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { classifySettingDate, parseBusinessDate, tokyoBusinessDate } from "./calendar";
import { analyzeScheduleImpact, type BreakDay, type ImpactRow, type ScheduleSetting, type WeeklyDay } from "./impact";
import { issueReviewToken, matchesReviewToken } from "./review-token";
import { getEffectiveScheduleForDate } from "./effective";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const row = record(value, ["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "days", "isOpen", "opensAt", "closesAt", "therapistId", "breaks", "reviewToken"]);
  if (typeof row.effectiveDate !== "string") throw new StoreInputError(400);
  let effectiveDate: Date;
  try { effectiveDate = parseBusinessDate(row.effectiveDate); } catch { throw new StoreInputError(400); }
  if (!Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1) throw new StoreInputError(400);
  if (row.expectedRevision !== undefined && (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 1)) throw new StoreInputError(400);
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (!reason || [...reason].length > 1000) throw new StoreInputError(400);
  let setting: ScheduleSetting;
  if (row.kind === "BUSINESS_WEEKLY") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "days", "reviewToken"].includes(key))) throw new StoreInputError(400);
    setting = { kind: row.kind, days: weekdays(row.days, "business") as WeeklyDay[] };
  } else if (row.kind === "BUSINESS_DATE") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "isOpen", "opensAt", "closesAt", "reviewToken"].includes(key))) throw new StoreInputError(400);
    setting = { kind: row.kind, ...business(row) };
  } else if (row.kind === "THERAPIST_BREAK") {
    if (Object.keys(row).some((key) => !["kind", "effectiveDate", "expectedVersion", "expectedRevision", "reason", "therapistId", "breaks", "reviewToken"].includes(key)) || typeof row.therapistId !== "string" || !uuid.test(row.therapistId)) throw new StoreInputError(400);
    setting = { kind: row.kind, therapistId: row.therapistId, breaks: weekdays(row.breaks, "break") as BreakDay[] };
  } else throw new StoreInputError(400);
  return { effectiveDate, effectiveDateText: row.effectiveDate, expectedVersion: row.expectedVersion as number, expectedRevision: row.expectedRevision as number | undefined, reason, setting, reviewToken: row.reviewToken };
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
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const therapists = await db.therapist.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } });
  const weekly = await latestWeekly(db, today);
  const breaks = await Promise.all(therapists.map(async (therapist) => ({ ...therapist, days: (await latestBreak(db, therapist.id, today))?.sort((a, b) => a.weekday - b.weekday).map((day) => ({ weekday: day.weekday, startsAt: hourText(day.startsAt), endsAt: hourText(day.endsAt) })) ?? null })));
  const plans = await db.schedulePlan.findMany({ where: { effectiveDate: { gte: tomorrow } }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }], include: { therapist: { select: { name: true } }, changes: { orderBy: { revision: "desc" }, take: 1, include: { businessSchedule: { include: { days: true } }, businessOverride: true, therapistSchedule: { include: { breaks: true } } } } } });
  const upcoming = plans.map((plan) => {
    const head = plan.changes[0];
    const setting: ScheduleSetting | null = head?.action === "CANCEL" ? null : plan.kind === "BUSINESS_WEEKLY" && head?.businessSchedule ? { kind: "BUSINESS_WEEKLY", days: head.businessSchedule.days.sort((a, b) => a.weekday - b.weekday).map((day) => ({ weekday: day.weekday, isOpen: day.isOpen, opensAt: day.opensAt?.getUTCHours() ?? null, closesAt: day.closesAt.getUTCHours() })) } : plan.kind === "BUSINESS_DATE" && head?.businessOverride ? { kind: "BUSINESS_DATE", isOpen: head.businessOverride.isOpen, opensAt: head.businessOverride.opensAt?.getUTCHours() ?? null, closesAt: head.businessOverride.closesAt.getUTCHours() } : plan.kind === "THERAPIST_BREAK" && head?.therapistSchedule && plan.therapistId ? { kind: "THERAPIST_BREAK", therapistId: plan.therapistId, breaks: head.therapistSchedule.breaks.sort((a, b) => a.weekday - b.weekday).map((rest) => ({ weekday: rest.weekday, startsAt: rest.startsAt?.getUTCHours() ?? null, endsAt: rest.endsAt?.getUTCHours() ?? null })) } : null;
    return { id: plan.id, kind: plan.kind, effectiveDate: plan.effectiveDate.toISOString().slice(0, 10), therapistName: plan.therapist?.name ?? null, revision: head?.revision ?? 0, canceled: head?.action === "CANCEL", reason: head?.reason ?? "", setting, mode: classifySettingDate(plan.effectiveDate.toISOString().slice(0, 10), new Date()).mode };
  });
  return { version: state?.version ?? 1, today: today.toISOString().slice(0, 10), weekly: weekly?.sort((a, b) => a.weekday - b.weekday).map((day) => ({ weekday: day.weekday, isOpen: day.isOpen, opensAt: hourText(day.opensAt), closesAt: hourText(day.closesAt) })) ?? null, therapists: breaks, upcoming };
}

export async function readManagedEffectiveSchedule(value: string) {
  await requireStoreAction("STORE_VIEW");
  try { parseBusinessDate(value); } catch { throw new StoreInputError(400); }
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    return { date: value, ...await getEffectiveScheduleForDate(tx, value) };
  }, { isolationLevel: "RepeatableRead" });
}

type ParsedInput = ReturnType<typeof parseInput>;

async function recordScheduleImpact(tx: Prisma.TransactionClient, auditId: string, impact: ImpactRow[]) {
  for (const row of impact) {
    if (row.after && row.before !== row.after) {
      await tx.reservationChangeNotice.create({ data: { reservationId: row.reservationId, changeAuditId: auditId, reservationVersion: row.reservationVersion, reason: row.after, proposedChange: { before: row.before, after: row.after, cutoffBefore: row.cutoffBefore, cutoffAfter: row.cutoffAfter } } });
    } else if (row.before && !row.after) {
      await tx.reservationChangeNotice.updateMany({ where: { reservationId: row.reservationId, resolvedAt: null, responseStatus: { notIn: ["RESOLVED", "IMPACT_RESOLVED_PENDING_REVIEW"] } }, data: { responseStatus: "IMPACT_RESOLVED_PENDING_REVIEW", version: { increment: 1 } } });
    }
  }
}

async function prepareScheduleChange(tx: Prisma.TransactionClient, request: Request, parsed: ParsedInput, lock: boolean) {
    const action = parsed.setting.kind === "THERAPIST_BREAK" ? "THERAPIST_BREAK_MANAGE" : "BUSINESS_SETTING_MANAGE";
    const claims = await requireStoreMutation(tx, request, action);
    if (lock) {
      await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
      await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
    }
    const state = await tx.storeSettingState.findUnique({ where: { id: 1 } });
    const version = state?.version ?? 1;
    if (version !== parsed.expectedVersion) throw new StoreInputError(409);
    let mode;
    try { mode = classifySettingDate(parsed.effectiveDateText, new Date()); } catch { throw new StoreInputError(400); }
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
    const plan = await tx.schedulePlan.findFirst({ where: { kind: parsed.setting.kind, therapistId, effectiveDate: parsed.effectiveDate } });
    let previous;
    if (plan) {
      previous = await tx.scheduleSettingChange.findFirst({ where: { planId: plan.id }, orderBy: { revision: "desc" } });
      if (!previous || previous.action === "CANCEL") throw new StoreInputError(409);
      if (parsed.expectedRevision === undefined) throw new StoreInputError(409, "ExistingPlanReviewPending");
      if (parsed.expectedRevision !== previous.revision) throw new StoreInputError(409);
    } else {
      if (parsed.expectedRevision !== undefined) throw new StoreInputError(409);
    }
    const impact = await analyzeScheduleImpact(tx, { effectiveDate: parsed.effectiveDate, setting: parsed.setting });
    const subject = { actor: `${claims.role}:${claims.principalId}`, version, effectiveDate: parsed.effectiveDateText, expectedRevision: parsed.expectedRevision ?? null, reason: parsed.reason, setting: parsed.setting, mode: mode.mode, impact };
    return { claims, version, mode, therapistId, plan, previous, impact, subject };
}

export async function previewManagedSchedule(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const parsed = parseInput(input);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const prepared = await prepareScheduleChange(tx, request, parsed, false);
    return { mode: prepared.mode.mode, daysUntilEffective: prepared.mode.days, impact: prepared.impact, reviewToken: issueReviewToken(prepared.subject) };
  });
}

export async function saveManagedSchedule(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const parsed = parseInput(input);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const { claims, version, mode, therapistId, previous, impact, subject } = await prepareScheduleChange(tx, request, parsed, true);
    if (!matchesReviewToken(parsed.reviewToken, subject)) throw new StoreInputError(409, "ReviewRequired");
    let plan = await tx.schedulePlan.findFirst({ where: { kind: parsed.setting.kind, therapistId, effectiveDate: parsed.effectiveDate } });
    if (!plan) plan = await tx.schedulePlan.create({ data: { kind: parsed.setting.kind, therapistId, effectiveDate: parsed.effectiveDate } });
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
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: previous ? "SCHEDULE_REVISED" : "SCHEDULE_CREATED", targetType: "SchedulePlan", targetId: plan.id, changes: { kind: parsed.setting.kind, effectiveDate: parsed.effectiveDateText, revision: (previous?.revision ?? 0) + 1, affected: impact.filter((row) => row.after && row.before !== row.after).length, resolved: impact.filter((row) => row.before && !row.after).length, cutoffChanges: impact.filter((row) => row.cutoffBefore !== row.cutoffAfter).map((row) => ({ reservationId: row.reservationId, before: row.cutoffBefore, after: row.cutoffAfter })) } } });
    const change = await tx.scheduleSettingChange.create({ data: { planId: plan.id, revision: (previous?.revision ?? 0) + 1, previousId: previous?.id, action: previous ? "REVISE" : "CREATE", reason: parsed.reason, auditId: audit.id, ...content } });
    await recordScheduleImpact(tx, audit.id, impact);
    await tx.storeSettingState.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    return { planId: plan.id, revision: change.revision, version: version + 1, mode: mode.mode, affected: impact.filter((row) => row.after && row.before !== row.after).length };
  });
}

function parseCancel(value: unknown) {
  const row = record(value, ["planId", "expectedVersion", "expectedRevision", "reason", "reviewToken"]);
  if (typeof row.planId !== "string" || !uuid.test(row.planId) || !Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1 || !Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 1) throw new StoreInputError(400);
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (!reason || [...reason].length > 1000) throw new StoreInputError(400);
  return { planId: row.planId, expectedVersion: row.expectedVersion as number, expectedRevision: row.expectedRevision as number, reason, reviewToken: row.reviewToken };
}

async function prepareCancellation(tx: Prisma.TransactionClient, request: Request, input: ReturnType<typeof parseCancel>, lock: boolean) {
  const plan = await tx.schedulePlan.findUnique({ where: { id: input.planId }, include: { changes: { orderBy: { revision: "desc" }, take: 1 } } });
  if (!plan) throw new StoreInputError(404);
  const claims = await requireStoreMutation(tx, request, plan.kind === "THERAPIST_BREAK" ? "THERAPIST_BREAK_MANAGE" : "BUSINESS_SETTING_MANAGE");
  if (lock) {
    await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
  }
  const version = (await tx.storeSettingState.findUnique({ where: { id: 1 }, select: { version: true } }))?.version ?? 1;
  const head = plan.changes[0];
  if (version !== input.expectedVersion || !head || head.revision !== input.expectedRevision || head.action === "CANCEL") throw new StoreInputError(409);
  const effectiveDate = plan.effectiveDate.toISOString().slice(0, 10);
  let mode;
  try { mode = classifySettingDate(effectiveDate, new Date()); } catch { throw new StoreInputError(409); }
  const impact = await analyzeScheduleImpact(tx, { effectiveDate: plan.effectiveDate, cancelPlanId: plan.id, kind: plan.kind, therapistId: plan.therapistId });
  const subject = { actor: `${claims.role}:${claims.principalId}`, version, planId: plan.id, revision: head.revision, effectiveDate, reason: input.reason, mode: mode.mode, impact };
  return { plan, head, claims, version, mode, impact, subject };
}

export async function previewCancelManagedSchedule(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const parsed = parseCancel(input);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const prepared = await prepareCancellation(tx, request, parsed, false);
    return { mode: prepared.mode.mode, daysUntilEffective: prepared.mode.days, impact: prepared.impact, reviewToken: issueReviewToken(prepared.subject) };
  });
}

export async function cancelManagedSchedule(request: Request, input: unknown) {
  checkMutationOrigin(request);
  const parsed = parseCancel(input);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const { plan, head, claims, version, mode, impact, subject } = await prepareCancellation(tx, request, parsed, true);
    if (!matchesReviewToken(parsed.reviewToken, subject)) throw new StoreInputError(409, "ReviewRequired");
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: "SCHEDULE_CANCELED", targetType: "SchedulePlan", targetId: plan.id, changes: { kind: plan.kind, effectiveDate: plan.effectiveDate.toISOString().slice(0, 10), revision: head.revision + 1, affected: impact.filter((row) => row.after && row.before !== row.after).length, cutoffChanges: impact.filter((row) => row.cutoffBefore !== row.cutoffAfter).map((row) => ({ reservationId: row.reservationId, before: row.cutoffBefore, after: row.cutoffAfter })) } } });
    const change = await tx.scheduleSettingChange.create({ data: { planId: plan.id, revision: head.revision + 1, previousId: head.id, action: "CANCEL", reason: parsed.reason, auditId: audit.id } });
    await recordScheduleImpact(tx, audit.id, impact);
    await tx.storeSettingState.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    return { planId: plan.id, revision: change.revision, version: version + 1, mode: mode.mode, affected: impact.filter((row) => row.after && row.before !== row.after).length };
  });
}
