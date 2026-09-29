import { parseBusinessDate } from "../schedules/calendar";

export type PricePart = { durationMinutes: number; priceYen: number };
export type BookingTotals = { totalDurationMinutes: number; totalPriceYen: number; slotCount: number };
export type Occupancy = { therapistId: string; roomId: string; startsAt: number; occupiesUntil: number; status: string };
export type Resource = { id: string; createdAt: number; breakStart: number | null; breakEnd: number | null };
export type Assignment = { roomId: string; therapistId: string; startsAt: string; treatmentEndsAt: string; occupiesUntil: string; slotStartsAt: string[] };

export function calculateTotals(treatment: PricePart, options: PricePart[]): BookingTotals {
  const parts = [treatment, ...options];
  if (parts.some((part, index) => !Number.isSafeInteger(part.durationMinutes) || part.durationMinutes < (index ? 0 : 1) || part.durationMinutes > 1380 || !Number.isSafeInteger(part.priceYen) || part.priceYen < 0 || part.priceYen > 1_000_000)) throw new Error("Invalid booking item.");
  const totalDurationMinutes = parts.reduce((sum, part) => sum + part.durationMinutes, 0);
  const totalPriceYen = parts.reduce((sum, part) => sum + part.priceYen, 0);
  if (totalDurationMinutes > 1380 || totalPriceYen > 1_000_000) throw new Error("Booking total exceeds limit.");
  return { totalDurationMinutes, totalPriceYen, slotCount: Math.ceil(totalDurationMinutes / 60) };
}

export function tokyoInstant(date: string, hour: number): number {
  return parseBusinessDate(date).getTime() + (hour - 9) * 3_600_000;
}

export function bookingWindow(date: string, previousClosesAt: number, now: number): boolean {
  const startDate = new Date(parseBusinessDate(date).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const previousDate = new Date(parseBusinessDate(date).getTime() - 86_400_000).toISOString().slice(0, 10);
  return now >= tokyoInstant(startDate, 0) && now <= tokyoInstant(previousDate, previousClosesAt);
}

function overlaps(a: number, b: number, c: number, d: number) { return a < d && b > c; }
function fixedOrder(a: Resource, b: Resource) { return a.createdAt - b.createdAt || a.id.localeCompare(b.id); }

/** All input times are instants in milliseconds. Intervals are [start, end). */
export function assignAt(date: string, startHour: number, totals: BookingTotals, opensAt: number, closesAt: number, rooms: Resource[], therapists: Resource[], existing: Occupancy[], now: number): Assignment | null {
  if (!Number.isInteger(startHour) || startHour < opensAt || startHour >= closesAt) return null;
  const startsAt = tokyoInstant(date, startHour);
  const treatmentEndsAt = startsAt + totals.totalDurationMinutes * 60_000;
  const occupiesUntil = startsAt + totals.slotCount * 3_600_000;
  if (occupiesUntil > tokyoInstant(date, closesAt) || treatmentEndsAt > tokyoInstant(date, closesAt)) return null;
  const overrun = existing.filter(row => row.status === "IN_PROGRESS" && row.occupiesUntil <= now);
  const room = rooms.filter(candidate => !overrun.some(row => row.roomId === candidate.id) && !existing.some(row => row.roomId === candidate.id && overlaps(startsAt, occupiesUntil, row.startsAt, row.occupiesUntil))).sort(fixedOrder)[0];
  if (!room) return null;
  const candidates = therapists.filter(candidate => candidate.breakStart !== null && candidate.breakEnd !== null && !overlaps(startsAt, occupiesUntil, candidate.breakStart, candidate.breakEnd) && !overrun.some(row => row.therapistId === candidate.id) && !existing.some(row => row.therapistId === candidate.id && overlaps(startsAt, occupiesUntil, row.startsAt, row.occupiesUntil)));
  candidates.sort((a, b) => {
    const rowsA = existing.filter(row => row.therapistId === a.id);
    const rowsB = existing.filter(row => row.therapistId === b.id);
    const adjacent = (rows: Occupancy[]) => rows.filter(row => row.occupiesUntil === startsAt || row.startsAt === occupiesUntil).length;
    const occupied = (rows: Occupancy[]) => rows.reduce((sum, row) => sum + Math.max(0, row.occupiesUntil - row.startsAt), 0);
    return adjacent(rowsA) - adjacent(rowsB) || occupied(rowsA) - occupied(rowsB) || fixedOrder(a, b);
  });
  if (!candidates[0]) return null;
  return { roomId: room.id, therapistId: candidates[0].id, startsAt: new Date(startsAt).toISOString(), treatmentEndsAt: new Date(treatmentEndsAt).toISOString(), occupiesUntil: new Date(occupiesUntil).toISOString(), slotStartsAt: Array.from({ length: totals.slotCount }, (_, index) => new Date(startsAt + index * 3_600_000).toISOString()) };
}
