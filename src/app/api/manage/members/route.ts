import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireStoreAction("RESERVATION_CREATE");
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() ?? "";
    if ([...url.searchParams.keys()].some(key => key !== "query") || [...query].length < 2 || [...query].length > 100) return Response.json({ error: "InvalidInput" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const members = await getPrisma().member.findMany({
      where: { OR: [{ email: { contains: query, mode: "insensitive" } }, { lastName: { contains: query } }, { firstName: { contains: query } }, { phoneNumber: { contains: query } }] },
      select: { id: true, lastName: true, firstName: true, email: true, phoneNumber: true, status: true, isDeleted: true, emailVerifiedAt: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], take: 20,
    });
    return Response.json({ members: members.map(({ emailVerifiedAt, ...member }) => ({ ...member, bookable: member.status === "ACTIVE" && !member.isDeleted && !!emailVerifiedAt })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreAccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
