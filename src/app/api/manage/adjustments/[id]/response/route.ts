import { updateAdjustmentResponse, adjustmentResponseFailure } from "@/lib/manage/adjustment-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await updateAdjustmentResponse(request, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adjustmentResponseFailure(error); }
}
