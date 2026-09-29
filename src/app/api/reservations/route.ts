import { bookingFailure, createReservation } from "@/lib/booking/mutations";
import { readJsonBody } from "@/lib/auth/store-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return Response.json(await createReservation(request, await readJsonBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}
