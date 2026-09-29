import { withdrawSelf, withdrawalFailure } from "@/lib/member/withdraw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return Response.json(await withdrawSelf(request), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return withdrawalFailure(error); }
}
