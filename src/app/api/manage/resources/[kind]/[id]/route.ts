import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";
import { changeResource, resourceKind } from "@/lib/manage/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind, id } = await params;
    const saved = await changeResource(request, resourceKind(kind), id, await readJsonBody(request));
    return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
