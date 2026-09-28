import { consumeMemberLink, memberFailure } from "@/lib/member/manage";
export const runtime = "nodejs";
export async function POST(request: Request) { try { return await consumeMemberLink(request, "MEMBERSHIP_CONFIRM"); } catch (error) { return memberFailure(error); } }
