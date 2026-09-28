import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";
import { createResource, listResources, resourceKind } from "@/lib/manage/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = resourceKind((await params).kind);
    const resources = await listResources();
    return Response.json({ items: resources[kind] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = resourceKind((await params).kind);
    const created = await createResource(request, kind, await readJsonBody(request));
    return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
