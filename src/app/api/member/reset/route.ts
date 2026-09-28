import { consumeMemberLink, memberFailure } from "@/lib/member/manage";
export const runtime = "nodejs";
export async function POST(request: Request) { try { return await consumeMemberLink(request, "PASSWORD_RESET"); } catch (error) { return memberFailure(error); } }
