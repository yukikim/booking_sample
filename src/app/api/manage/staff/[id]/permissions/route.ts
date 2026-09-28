import { changeStaffPermission, readStaffBody, staffMutationFailure } from "@/lib/manage/staff-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await changeStaffPermission(request, id, await readStaffBody(request));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return staffMutationFailure(error); }
}
