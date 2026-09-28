import "server-only";

import { getStoreSession, AuthUnavailable } from "@/auth";
import { getPrisma } from "@/lib/prisma";

export class MemberAccessError extends Error {
  constructor(readonly status: 401 | 403 | 503) { super(status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable"); }
}

/** Use this at every member booking entry point; never accept a member ID from the client. */
export async function requireBookableMember() {
  let session;
  try { session = await getStoreSession(); }
  catch (error) { if (error instanceof AuthUnavailable) throw new MemberAccessError(503); throw error; }
  if (!session) throw new MemberAccessError(401);
  if (session.user.role !== "MEMBER") throw new MemberAccessError(403);
  try {
    const member = await getPrisma().member.findUnique({ where: { id: session.user.id }, select: { id: true, status: true, isDeleted: true, emailVerifiedAt: true } });
    if (!member || member.status !== "ACTIVE" || member.isDeleted || !member.emailVerifiedAt) throw new MemberAccessError(403);
    return { memberId: member.id };
  } catch (error) { if (error instanceof MemberAccessError) throw error; throw new MemberAccessError(503); }
}
