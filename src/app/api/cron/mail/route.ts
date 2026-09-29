import { createResendSender } from "@/lib/mail/provider";
import { runMailBatch } from "@/lib/mail/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try { return Response.json(await runMailBatch(createResendSender(), 3), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "TemporarilyUnavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
