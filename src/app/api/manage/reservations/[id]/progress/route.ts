import { readJsonBody } from "@/lib/auth/store-mutation";
import { bookingFailure } from "@/lib/booking/mutations";
import { progressReservation } from "@/lib/booking/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const step = new URL(request.url).searchParams.get("step");
    if (step !== "start" && step !== "complete") return Response.json({ error: "InvalidInput" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json(await progressReservation(request, (await params).id, step, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return bookingFailure(error); }
}
