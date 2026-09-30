import { MemberAccessError } from "@/lib/auth/member";
import { getWithdrawalPreview } from "@/lib/member/withdraw-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ preview: await getWithdrawalPreview() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const status = error instanceof MemberAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
