import { MemberAccessError } from "@/lib/auth/member";
import { readJsonBody } from "@/lib/auth/store-mutation";
import { bookingFailure, createReservation } from "@/lib/booking/mutations";
import { listMemberReservations } from "@/lib/booking/member-reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return Response.json({ error: "InvalidInput" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json({ reservations: await listMemberReservations() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MemberAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try { return Response.json(await createReservation(request, await readJsonBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return bookingFailure(error); }
}
