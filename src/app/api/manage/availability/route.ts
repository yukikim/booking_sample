import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { findAvailability, parseAvailabilityRequest } from "@/lib/booking/availability";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    await requireStoreAction("RESERVATION_UPDATE");
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => !["date", "treatmentId", "optionId", "reservationId", "roomId", "therapistId", "storeException"].includes(key))) throw new Error("InvalidInput");
    const reservationId = url.searchParams.get("reservationId") ?? "";
    const roomId = url.searchParams.get("roomId") ?? "";
    const therapistId = url.searchParams.get("therapistId") ?? "";
    const exception = url.searchParams.get("storeException") === "true";
    if (!uuid.test(reservationId) || (roomId && !uuid.test(roomId)) || (therapistId && !uuid.test(therapistId)) || !!roomId !== !!therapistId || ![null, "true", "false"].includes(url.searchParams.get("storeException"))) throw new Error("InvalidInput");
    if (exception) await requireStoreAction("RESERVATION_EXCEPTION");
    const reservation = await getPrisma().reservation.findUnique({ where: { id: reservationId }, select: { status: true } });
    if (!reservation || reservation.status !== "CONFIRMED") return Response.json({ error: "NotFound" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const input = parseAvailabilityRequest({ date: url.searchParams.get("date"), treatmentId: url.searchParams.get("treatmentId"), optionIds: url.searchParams.getAll("optionId") });
    const result = await findAvailability(input, new Date(), { excludeReservationId: reservationId, ignoreBookingWindow: exception, ...(roomId ? { roomId, therapistId } : {}) });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreAccessError ? error.status : error instanceof Error && /Invalid|Use a valid/.test(error.message) ? 400 : 503;
    return Response.json({ error: status === 400 ? "InvalidInput" : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
