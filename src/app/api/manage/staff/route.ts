import { StoreAccessError } from "@/lib/auth/permissions";
import { getStaffRoster } from "@/lib/manage/staff-roster";
import { createStaff } from "@/lib/manage/staff-mutations";
import { readJsonBody, mutationFailure } from "@/lib/auth/store-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const staff = await getStaffRoster();
    return Response.json({ staff }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreAccessError ? error.status : 503;
    return Response.json({ error: status === 503 ? "TemporarilyUnavailable" : status === 403 ? "Forbidden" : "Unauthorized" }, {
      status, headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  try {
    const created = await createStaff(request, await readJsonBody(request));
    return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
