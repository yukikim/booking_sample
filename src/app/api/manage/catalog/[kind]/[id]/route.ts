import { catalogKind, changeCatalog } from "@/lib/manage/catalog";
import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind, id } = await params;
    const saved = await changeCatalog(request, catalogKind(kind), id, await readJsonBody(request));
    return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
