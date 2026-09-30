import { parseBusinessDate, tokyoBusinessDate } from "../schedules/calendar";

export const BOOKING_LOOKAHEAD_DAYS = 30;
export function addCalendarDays(date: string, days: number) {
  return new Date(parseBusinessDate(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
export function bookingCalendarRange(now: Date) {
  const today = tokyoBusinessDate(now);
  return {
    today,
    endDate: addCalendarDays(today, BOOKING_LOOKAHEAD_DAYS),
    dates: Array.from({ length: BOOKING_LOOKAHEAD_DAYS }, (_, index) => addCalendarDays(today, index + 1)),
  };
}
export function calendarMonths(today: string, endDate: string) {
  const months: string[] = [];
  let month = `${today.slice(0, 7)}-01`;
  while (month <= endDate) {
    months.push(month);
    const next = parseBusinessDate(month);
    next.setUTCMonth(next.getUTCMonth() + 1);
    month = next.toISOString().slice(0, 10);
  }
  return months;
}
export function calendarMonthCells(month: string) {
  const first = parseBusinessDate(month);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days = (next.getTime() - first.getTime()) / 86_400_000;
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 0; day < days; day++) cells.push(addCalendarDays(month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}
