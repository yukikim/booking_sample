import { MemberAccessError } from "@/lib/auth/member";
import { readJsonBody } from "@/lib/auth/store-mutation";
import { bookingFailure, cancelReservation, changeReservation } from "@/lib/booking/mutations";
import { getMemberReservation } from "@/lib/booking/member-reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const reservation = await getMemberReservation((await params).id);
    if (!reservation) return Response.json({ error: "NotFound" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ reservation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MemberAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await changeReservation(request, (await params).id, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await cancelReservation(request, (await params).id, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}
