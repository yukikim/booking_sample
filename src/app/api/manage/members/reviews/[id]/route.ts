import { decideMemberReview, memberReviewFailure } from "@/lib/member/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await decideMemberReview(request, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return memberReviewFailure(error); }
}
