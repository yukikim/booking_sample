import { mutationFailure, readJsonBody } from "@/lib/auth/store-mutation";
import { cancelManagedSchedule, previewCancelManagedSchedule } from "@/lib/schedules/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return Response.json(await cancelManagedSchedule(request, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mutationFailure(error); }
}

export async function PUT(request: Request) {
  try { return Response.json(await previewCancelManagedSchedule(request, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mutationFailure(error); }
}
