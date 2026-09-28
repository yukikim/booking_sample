import { type NextRequest } from "next/server";
import { createStoreAuth } from "@/auth";
import { authEnvironment } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest) {
  try {
    const env = authEnvironment();
    // Host trust is anchored to server configuration, never to forwarded headers.
    if (request.method === "POST" && request.headers.get("origin") !== env.origin) return Response.json({ error: "Forbidden" }, { status: 403 });
    const instance = createStoreAuth();
    const response = await instance.handlers[request.method === "POST" ? "POST" : "GET"](request);
    if (instance.state.forbidden) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (instance.state.unavailable) throw new Error();
    if (instance.state.rateLimited) {
      response.headers.set("Retry-After", "900");
      return new Response(response.body, { status: 429, headers: response.headers });
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return Response.json({ error: "TemporarilyUnavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
