import { registerMember, memberFailure } from "@/lib/member/manage";
export const runtime = "nodejs";
export async function POST(request: Request) { try { return await registerMember(request); } catch (error) { return memberFailure(error); } }
