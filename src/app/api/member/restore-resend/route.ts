import { requestMemberLink, memberFailure } from "@/lib/member/manage";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) { try { return await requestMemberLink(request, "RESTORE_CONFIRM"); } catch (error) { return memberFailure(error); } }
