export function formatTokyo(instant: string) {
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const value = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return `${value("year")}年${value("month")}月${value("day")}日 ${value("hour")}:${value("minute")}`;
}

export function reservationStatus(status: string) {
  return status === "CONFIRMED" ? "予約済み" : status === "CANCELLED" ? "キャンセル済み" : status === "IN_PROGRESS" ? "施術中" : status === "COMPLETED" ? "完了" : status;
}
