/** A business date is a Tokyo calendar date, represented as UTC midnight for @db.Date. */
export function parseBusinessDate(value: string): Date {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000")) {
    throw new Error("Use a valid YYYY-MM-DD business date.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Use a valid YYYY-MM-DD business date.");
  }
  return date;
}

export function tokyoBusinessDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const get = (name: string) => parts.find(part => part.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Initial seed is the sole exception to this future-only editing rule. */
export function classifySettingDate(effectiveDate: string, savedAt: Date) {
  const days = (parseBusinessDate(effectiveDate).getTime() - parseBusinessDate(tokyoBusinessDate(savedAt)).getTime()) / 86_400_000;
  if (days < 1) throw new Error("Changes must take effect tomorrow or later.");
  return { days, mode: days <= 30 ? "NEAR_TERM" as const : "ADVANCE" as const };
}
