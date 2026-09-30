import { withdrawSelf, withdrawalFailure } from "@/lib/member/withdraw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const result = await withdrawSelf(request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", "authjs.session-token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    headers.append("Set-Cookie", "__Secure-authjs.session-token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
    return Response.json(result, { headers });
  }
  catch (error) { return withdrawalFailure(error); }
}
