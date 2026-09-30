import { findAvailability, parseAvailabilityRequest } from "@/lib/booking/availability";
import { bookingCalendarRange } from "@/lib/booking/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => !["treatmentId", "optionId"].includes(key))) throw new Error("Invalid query.");
    const now = new Date();
    const range = bookingCalendarRange(now);
    const input = parseAvailabilityRequest({ date: range.dates[0], treatmentId: url.searchParams.get("treatmentId"), optionIds: url.searchParams.getAll("optionId") });
    const days: { date: string; availableCount: number; outsideWindow: boolean }[] = [];
    let nextIndex = 0;
    // Keep daily evaluations identical to the existing search and bound DB concurrency.
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (nextIndex < range.dates.length) {
        const index = nextIndex++;
        const date = range.dates[index];
        const result = await findAvailability({ ...input, date }, now);
        days[index] = { date, availableCount: result.times.length, outsideWindow: result.outsideWindow };
      }
    }));
    return Response.json({ today: range.today, endDate: range.endDate, days }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && /Invalid|Use a valid|Inactive|exceeds/.test(error.message) ? 400 : 503;
    return Response.json({ error: status === 400 ? "InvalidInput" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
