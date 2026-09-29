import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { getEffectiveBusinessDay, getEffectiveTherapistBreak } from "@/lib/schedules/effective";
import { parseBusinessDate } from "@/lib/schedules/calendar";
import { assignAt, bookingWindow, calculateTotals, tokyoInstant, type Assignment, type Occupancy, type Resource } from "./availability-core";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AvailabilityRequest = { date: string; treatmentId: string; optionIds: string[] };

export function parseAvailabilityRequest(value: unknown): AvailabilityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid availability request.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["date", "treatmentId", "optionIds"].includes(key)) || typeof row.date !== "string" || typeof row.treatmentId !== "string" || !uuid.test(row.treatmentId) || !Array.isArray(row.optionIds) || row.optionIds.length > 100 || row.optionIds.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(row.optionIds).size !== row.optionIds.length) throw new Error("Invalid availability request.");
  parseBusinessDate(row.date);
  return { date: row.date, treatmentId: row.treatmentId, optionIds: row.optionIds as string[] };
}

export async function evaluateAvailability(tx: Prisma.TransactionClient, input: AvailabilityRequest, now: Date) {
  const date = parseBusinessDate(input.date);
  const previousDate = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
  const [business, previous, treatment, options, rooms, therapists, reservations, overruns] = await Promise.all([
    getEffectiveBusinessDay(tx, input.date), getEffectiveBusinessDay(tx, previousDate),
    tx.treatment.findUnique({ where: { id: input.treatmentId } }),
    tx.option.findMany({ where: { id: { in: input.optionIds } } }),
    tx.room.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.therapist.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.reservation.findMany({ where: { businessDate: date, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { roomId: true, therapistId: true, startsAt: true, occupiesUntil: true, status: true } }),
    tx.reservation.findMany({ where: { status: "IN_PROGRESS", occupiesUntil: { lte: now } }, select: { roomId: true, therapistId: true, startsAt: true, occupiesUntil: true, status: true } }),
  ]);
  if (!treatment?.isActive || options.length !== input.optionIds.length || options.some(option => !option.isActive)) throw new Error("Inactive or missing menu selection.");
  const totals = calculateTotals(treatment, options);
  const closesAt = business?.closesAt.getUTCHours();
  const opensAt = business?.opensAt?.getUTCHours();
  const allowed = Boolean(business?.isOpen && opensAt !== undefined && closesAt !== undefined && previous && bookingWindow(input.date, previous.closesAt.getUTCHours(), now.getTime()));
  const result: { totals: typeof totals; times: Assignment[] } = { totals, times: [] };
  if (!allowed || opensAt === undefined || closesAt === undefined) return result;
  const rest = await Promise.all(therapists.map(person => getEffectiveTherapistBreak(tx, person.id, input.date)));
  const toResource = (resource: { id: string; createdAt: Date }, index: number): Resource => ({ id: resource.id, createdAt: resource.createdAt.getTime(), breakStart: rest[index]?.startsAt ? tokyoInstant(input.date, rest[index].startsAt.getUTCHours()) : null, breakEnd: rest[index]?.endsAt ? tokyoInstant(input.date, rest[index].endsAt.getUTCHours()) : null });
  const people = therapists.map(toResource).filter((person, index) => rest[index]?.startsAt && rest[index]?.endsAt && rest[index].startsAt! >= business!.opensAt! && rest[index].endsAt! <= business!.closesAt);
  const roomResources: Resource[] = rooms.map(room => ({ id: room.id, createdAt: room.createdAt.getTime(), breakStart: null, breakEnd: null }));
  const occupied: Occupancy[] = [...reservations, ...overruns].map(row => ({ roomId: row.roomId, therapistId: row.therapistId, startsAt: row.startsAt.getTime(), occupiesUntil: row.occupiesUntil.getTime(), status: row.status }));
  for (let hour = opensAt; hour < closesAt; hour++) {
    const assignment = assignAt(input.date, hour, totals, opensAt, closesAt, roomResources, people, occupied, now.getTime());
    if (assignment) result.times.push(assignment);
  }
  return result;
}

export async function findAvailability(input: AvailabilityRequest, now = new Date()) {
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    return evaluateAvailability(tx, input, now);
  }, { isolationLevel: "RepeatableRead" });
}

/** Call immediately before inserting reservation and slots in the same transaction. */
export async function revalidateAtSave(tx: Prisma.TransactionClient, input: AvailabilityRequest, startsAt: string, now = new Date()) {
  const result = await evaluateAvailability(tx, input, now);
  return { totals: result.totals, assignment: result.times.find(time => time.startsAt === startsAt) ?? null };
}
