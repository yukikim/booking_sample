import { requireBookableMember, MemberAccessError } from "@/lib/auth/member";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { memberId } = await requireBookableMember();
    const member = await getPrisma().member.findUnique({ where: { id: memberId }, select: { lastName: true, firstName: true, email: true, phoneNumber: true } });
    if (!member) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json({ member }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof MemberAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
