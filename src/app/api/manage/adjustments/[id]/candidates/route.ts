import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { adjustmentCandidates } from "@/lib/manage/adjustment-candidates";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStoreAction("STORE_VIEW");
    const { id } = await params;
    if (!uuid.test(id)) return Response.json({ error: "InvalidInput" }, { status: 400 });
    const result = await getPrisma().$transaction(async tx => {
      await setTransactionSchema(tx);
      const notice = await tx.reservationChangeNotice.findUnique({ where: { id }, include: { reservation: { include: { options: { select: { optionId: true } } } } } });
      if (!notice) return null;
      return { noticeVersion: notice.version, reservationVersion: notice.reservation.version, candidates: await adjustmentCandidates(tx, notice.reservation) };
    }, { isolationLevel: "RepeatableRead" });
    return Response.json(result ?? { error: "NotFound" }, { status: result ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
