import assert from "node:assert/strict";
import test from "node:test";
import { classifySettingDate, parseBusinessDate, tokyoBusinessDate } from "../src/lib/schedules/calendar";

test("business dates reject invalid dates and accept leap days", () => {
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-01", "2026-13-01", "2026-09-28T00:00:00Z"]) assert.throws(() => parseBusinessDate(value));
  assert.equal(parseBusinessDate("2028-02-29").toISOString(), "2028-02-29T00:00:00.000Z");
});
test("Tokyo midnight changes the saving date and tomorrow eligibility", () => {
  const before = new Date("2026-09-28T14:59:59Z"), after = new Date("2026-09-28T15:00:00Z");
  assert.equal(tokyoBusinessDate(before), "2026-09-28");
  assert.equal(tokyoBusinessDate(after), "2026-09-29");
  assert.equal(classifySettingDate("2026-09-29", before).days, 1);
  assert.throws(() => classifySettingDate("2026-09-29", after));
});
test("near-term boundary is 30 calendar days; classify again at save time", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  assert.deepEqual(classifySettingDate("2026-10-28", now), { days: 30, mode: "NEAR_TERM" });
  assert.deepEqual(classifySettingDate("2026-10-29", now), { days: 31, mode: "ADVANCE" });
  assert.equal(classifySettingDate("2026-10-29", new Date("2026-09-29T00:00:00Z")).mode, "NEAR_TERM");
  assert.throws(() => classifySettingDate("2026-09-27", now));
});
