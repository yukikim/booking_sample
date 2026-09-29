import { readJsonBody } from "@/lib/auth/store-mutation";
import { bookingFailure, cancelReservation, changeReservation } from "@/lib/booking/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await changeReservation(request, (await params).id, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await cancelReservation(request, (await params).id, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}
