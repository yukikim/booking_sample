import { beginMemberRestore } from "@/lib/member/restore";
import { mutationFailure } from "@/lib/auth/store-mutation";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await beginMemberRestore(request, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mutationFailure(error); }
}
