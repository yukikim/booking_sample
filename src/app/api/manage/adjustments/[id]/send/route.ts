import { confirmChangeNoticeMail } from "@/lib/mail/notices";
import { mutationFailure } from "@/lib/auth/store-mutation";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await confirmChangeNoticeMail(request, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mutationFailure(error); }
}
