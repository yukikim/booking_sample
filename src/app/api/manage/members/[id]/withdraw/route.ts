import { withdrawManaged, withdrawalFailure } from "@/lib/member/withdraw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await withdrawManaged(request, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return withdrawalFailure(error); }
}
