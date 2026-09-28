import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";
import { listManagedSchedules, saveManagedSchedule } from "@/lib/schedules/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json(await listManagedSchedules(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mutationFailure(error); }
}

export async function POST(request: Request) {
  try {
    const saved = await saveManagedSchedule(request, await readJsonBody(request));
    return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mutationFailure(error); }
}
