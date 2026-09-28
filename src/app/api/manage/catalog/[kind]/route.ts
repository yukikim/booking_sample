import { catalogKind, createCatalog, listCatalog } from "@/lib/manage/catalog";
import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = catalogKind((await params).kind);
    const catalog = await listCatalog();
    return Response.json({ items: catalog[kind] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = catalogKind((await params).kind);
    const created = await createCatalog(request, kind, await readJsonBody(request));
    return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
