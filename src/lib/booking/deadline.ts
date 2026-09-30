import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getEffectiveBusinessDay } from "@/lib/schedules/effective";
import { parseBusinessDate } from "@/lib/schedules/calendar";
import { tokyoInstant } from "./availability-core";

/** Last open business day's configured closing instant before the reservation date. */
export async function cancellationDeadline(tx: Prisma.TransactionClient, date: string) {
  let day = parseBusinessDate(date);
  for (let i = 0; i < 366; i++) {
    day = new Date(day.getTime() - 86_400_000);
    const text = day.toISOString().slice(0, 10);
    const setting = await getEffectiveBusinessDay(tx, text);
    if (setting?.isOpen) return tokyoInstant(text, setting.closesAt.getUTCHours());
  }
  return null;
}
