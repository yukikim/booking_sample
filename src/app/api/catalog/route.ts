import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getPrisma();
    const [treatments, options] = await Promise.all([
      db.treatment.findMany({ where: { isActive: true }, select: { id: true, name: true, durationMinutes: true, priceYen: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      db.option.findMany({ where: { isActive: true }, select: { id: true, name: true, durationMinutes: true, priceYen: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    return Response.json({ treatments, options }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "TemporarilyUnavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
