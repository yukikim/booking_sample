import { findAvailability, parseAvailabilityRequest } from "@/lib/booking/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const treatmentId = url.searchParams.get("treatmentId");
    const optionIds = url.searchParams.getAll("optionId");
    if ([...url.searchParams.keys()].some(key => !["date", "treatmentId", "optionId"].includes(key))) throw new Error("Invalid query.");
    const input = parseAvailabilityRequest({ date, treatmentId, optionIds });
    const result = await findAvailability(input);
    return Response.json({ totals: result.totals, outsideWindow: result.outsideWindow, times: result.times.map(time => ({ startsAt: time.startsAt, treatmentEndsAt: time.treatmentEndsAt, occupiesUntil: time.occupiesUntil })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && (/Invalid|Use a valid|Inactive|exceeds/.test(error.message)) ? 400 : 503;
    return Response.json({ error: status === 400 ? "InvalidInput" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
