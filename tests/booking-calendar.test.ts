import assert from "node:assert/strict";
import test from "node:test";
import { bookingCalendarRange, calendarMonths, calendarMonthCells } from "../src/lib/booking/calendar";

test("calendar uses Tokyo dates and covers tomorrow through 30 days ahead across year end", () => {
  const before = bookingCalendarRange(new Date("2026-12-31T14:59:59Z"));
  const after = bookingCalendarRange(new Date("2026-12-31T15:00:00Z"));
  assert.equal(before.today, "2026-12-31");
  assert.equal(before.dates[0], "2027-01-01");
  assert.equal(before.endDate, "2027-01-30");
  assert.equal(before.dates.length, 30);
  assert.equal(before.dates.at(-1), before.endDate);
  assert.equal(after.today, "2027-01-01");
  assert.equal(after.dates[0], "2027-01-02");
});

test("30-day range may span three months and leap February is fully displayed", () => {
  const range = bookingCalendarRange(new Date("2027-01-31T00:00:00Z"));
  assert.deepEqual(calendarMonths(range.today, range.endDate), ["2027-01-01", "2027-02-01", "2027-03-01"]);
  const weeks = calendarMonthCells("2028-02-01");
  assert.ok(weeks.every(week => week.length === 7));
  assert.equal(weeks[0][2], "2028-02-01");
  const dates = weeks.flat().filter(Boolean);
  assert.equal(dates.length, 29);
  assert.equal(dates.at(-1), "2028-02-29");
});
