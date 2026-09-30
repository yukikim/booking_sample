import { getPrisma } from "@/lib/prisma";
import { authorizedOps, operationsHealth } from "@/lib/ops/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  if (!authorizedOps(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await operationsHealth(getPrisma());
    return Response.json(result, { status: result.status === "ok" ? 200 : 503, headers });
  } catch { return Response.json({ error: "TemporarilyUnavailable" }, { status: 503, headers }); }
}
