import assert from "node:assert/strict";
import test from "node:test";
import { assignAt, bookingWindow, calculateTotals, tokyoInstant, type Occupancy, type Resource } from "../src/lib/booking/availability-core";

const date = "2026-10-16";
const room = (id: string, order = 0): Resource => ({ id, createdAt: order, breakStart: null, breakEnd: null });
const person = (id: string, order = 0, breakHour = 13): Resource => ({ ...room(id, order), breakStart: tokyoInstant(date, breakHour), breakEnd: tokyoInstant(date, breakHour + 1) });
const occupied = (therapistId: string, roomId: string, start: number, end: number): Occupancy => ({ therapistId, roomId, startsAt: tokyoInstant(date, start), occupiesUntil: tokyoInstant(date, end), status: "CONFIRMED" });
const now = tokyoInstant("2026-09-29", 9);

test("totals keep minutes, round slots upward, and include zero minute options", () => {
  for (const [minutes, slots] of [[60, 1], [70, 2], [90, 2], [120, 2], [130, 3]]) assert.equal(calculateTotals({ durationMinutes: minutes, priceYen: 6000 }, []).slotCount, slots);
  assert.deepEqual(calculateTotals({ durationMinutes: 70, priceYen: 6000 }, [{ durationMinutes: 0, priceYen: 1000 }]), { totalDurationMinutes: 70, totalPriceYen: 7000, slotCount: 2 });
  assert.throws(() => calculateTotals({ durationMinutes: 1380, priceYen: 1_000_000 }, [{ durationMinutes: 1, priceYen: 1 }]));
});

test("booking window includes both boundaries and uses prior calendar day even when closed", () => {
  assert.equal(bookingWindow(date, 18, tokyoInstant("2026-09-15", 23) + 59 * 60_000), false);
  assert.equal(bookingWindow(date, 18, tokyoInstant("2026-09-16", 0)), true);
  assert.equal(bookingWindow(date, 18, tokyoInstant("2026-10-15", 18)), true);
  assert.equal(bookingWindow(date, 18, tokyoInstant("2026-10-15", 18) + 1), false);
});

test("70 minutes occupies two contiguous slots but closes at the precise treatment minute", () => {
  const result = assignAt(date, 10, calculateTotals({ durationMinutes: 70, priceYen: 6000 }, []), 9, 18, [room("r")], [person("t")], [], now)!;
  assert.equal(result.treatmentEndsAt, new Date(tokyoInstant(date, 10) + 70 * 60_000).toISOString());
  assert.equal(result.occupiesUntil, new Date(tokyoInstant(date, 12)).toISOString());
  assert.deepEqual(result.slotStartsAt, [10, 11].map(hour => new Date(tokyoInstant(date, hour)).toISOString()));
  assert.equal(assignAt(date, 17, calculateTotals({ durationMinutes: 60, priceYen: 0 }, []), 9, 18, [room("r")], [person("t")], [], now)?.roomId, "r");
  assert.equal(assignAt(date, 17, calculateTotals({ durationMinutes: 70, priceYen: 0 }, []), 9, 18, [room("r")], [person("t")], [], now), null);
});

test("same resources must stay free across all slots; adjacent intervals do not overlap", () => {
  const two = calculateTotals({ durationMinutes: 120, priceYen: 0 }, []);
  assert.equal(assignAt(date, 10, two, 9, 18, [room("r")], [person("a"), person("b")], [occupied("a", "r2", 10, 11), occupied("b", "r2", 11, 12)], now), null);
  assert.equal(assignAt(date, 10, two, 9, 18, [room("r")], [person("a")], [occupied("a", "r", 12, 13)], now)?.therapistId, "a");
  assert.equal(assignAt(date, 11, two, 9, 18, [room("r")], [person("a")], [], now)?.therapistId, "a");
  assert.equal(assignAt(date, 12, two, 9, 18, [room("r")], [person("a")], [], now), null);
  assert.equal(assignAt("2026-10-17", 10, two, 9, 18, [room("r")], [person("a")], [occupied("a", "r", 10, 12)], now)?.roomId, "r");
});

test("priority uses adjacent count, then occupied time, then fixed order; rooms use fixed order", () => {
  const one = calculateTotals({ durationMinutes: 60, priceYen: 0 }, []);
  const rows = [occupied("a", "old", 9, 10), occupied("b", "old2", 7, 9)];
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r2", 2), room("r1", 1)], [person("a", 1), person("b", 2)], rows, now)?.therapistId, "b");
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r2", 2), room("r1", 1)], [person("a", 1), person("b", 2)], [], now)?.roomId, "r1");
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r")], [person("a")], [occupied("a", "old", 9, 10)], now)?.therapistId, "a");
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r")], [person("a", 1), person("b", 2)], [occupied("a", "old", 14, 16), occupied("b", "old2", 14, 15)], now)?.therapistId, "b");
});

test("independent room and therapist counts limit simultaneous availability", () => {
  const one = calculateTotals({ durationMinutes: 60, priceYen: 0 }, []);
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r1"), room("r2")], [person("t1")], [occupied("t1", "r1", 10, 11)], now), null);
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r1")], [person("t1"), person("t2")], [occupied("t1", "r1", 10, 11)], now), null);
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r1"), room("r2")], [person("t1"), person("t2")], [occupied("t1", "r1", 10, 11)], now)?.therapistId, "t2");
  assert.equal(assignAt(date, 10, one, 9, 18, [], [person("t1")], [], now), null);
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r1")], [], [], now), null);
});

test("unset breaks and unfinished overruns remove resources", () => {
  const one = calculateTotals({ durationMinutes: 60, priceYen: 0 }, []);
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r")], [room("t")], [], now), null);
  const overrun = { ...occupied("t", "r", 9, 10), status: "IN_PROGRESS" };
  assert.equal(assignAt(date, 10, one, 9, 18, [room("r")], [person("t")], [overrun], tokyoInstant(date, 10)), null);
});
