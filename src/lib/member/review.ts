import "server-only";

import { createHash } from "node:crypto";
import { StoreAccessError } from "@/lib/auth/permissions";
import { checkMutationOrigin, readJsonBody, requireStoreMutation, StoreInputError } from "@/lib/auth/store-mutation";
import { lockBookingState } from "@/lib/booking/lock";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Decision = "DIFFERENT_PERSON" | "SAME_PERSON";

export class MemberReviewError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string) { super(code); }
}

export async function decideMemberReview(request: Request, reviewId: string) {
  checkMutationOrigin(request);
  if (!uuid.test(reviewId)) throw new MemberReviewError(400, "InvalidInput");
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new MemberReviewError(400, "InvalidInput");
  const input = body as Record<string, unknown>;
  const decision = input.decision as Decision;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (Object.keys(input).some(key => !["requestKey", "expectedReviewVersion", "expectedMemberVersion", "decision", "reason"].includes(key)) ||
      typeof input.requestKey !== "string" || !uuid.test(input.requestKey) ||
      !Number.isSafeInteger(input.expectedReviewVersion) || Number(input.expectedReviewVersion) < 1 ||
      !Number.isSafeInteger(input.expectedMemberVersion) || Number(input.expectedMemberVersion) < 1 ||
      !["DIFFERENT_PERSON", "SAME_PERSON"].includes(decision) || !reason || [...reason].length > 1000) throw new MemberReviewError(400, "InvalidInput");
  const requestHash = createHash("sha256").update(JSON.stringify({ reviewId, ...input, reason })).digest("hex");
  return getPrisma().$transaction(async tx => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, "MEMBER_REVIEW");
    if (claims.role !== "ADMIN") throw new StoreAccessError(403);
    await lockBookingState(tx);
    const old = await tx.auditLog.findUnique({ where: { requestKey: input.requestKey as string } });
    if (old) {
      const details = old.changes as Record<string, unknown> | null;
      if (old.actorAdminId !== claims.principalId || old.targetType !== "MemberReview" || old.targetId !== reviewId || details?.requestHash !== requestHash) throw new MemberReviewError(409, "RequestKeyConflict");
      return { reviewId, decision, memberStatus: details.resultStatus as string, replayed: true };
    }
    const reference = await tx.memberReview.findUnique({ where: { id: reviewId }, select: { memberId: true } });
    if (!reference) throw new MemberReviewError(404, "NotFound");
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${reference.memberId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "MemberReview" WHERE id = ${reviewId}::uuid FOR UPDATE`;
    const [review, member] = await Promise.all([
      tx.memberReview.findUniqueOrThrow({ where: { id: reviewId } }),
      tx.member.findUniqueOrThrow({ where: { id: reference.memberId } }),
    ]);
    if (review.decision !== "PENDING" || review.version !== input.expectedReviewVersion || member.version !== input.expectedMemberVersion || member.status !== "PENDING_REVIEW" || member.isDeleted || !member.emailVerifiedAt || member.firstActivatedAt) throw new MemberReviewError(409, "ReviewStateChanged");
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
    const resultStatus = decision === "DIFFERENT_PERSON" ? "ACTIVE" : "REJECTED";
    const audit = await tx.auditLog.create({ data: { requestKey: input.requestKey as string, actorType: "ADMIN", actorAdminId: claims.principalId, action: `MEMBER_REVIEW_${decision}`, targetType: "MemberReview", targetId: reviewId, changes: { requestHash, memberId: member.id, resultStatus, beforeMemberVersion: member.version, beforeReviewVersion: review.version } } });
    await tx.member.update({ where: { id: member.id }, data: { status: resultStatus, ...(resultStatus === "ACTIVE" ? { firstActivatedAt: now } : {}), version: { increment: 1 }, authVersion: { increment: 1 } } });
    await tx.memberReview.update({ where: { id: reviewId }, data: { decision, reason, reviewedByAdminId: claims.principalId, reviewedAt: now, decisionAuditId: audit.id, version: { increment: 1 } } });
    await tx.authToken.updateMany({ where: { memberId: member.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.appSession.updateMany({ where: { memberId: member.id, revokedAt: null }, data: { revokedAt: now } });
    return { reviewId, decision, memberStatus: resultStatus, replayed: false };
  }, { timeout: 20_000 });
}

export function memberReviewFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = error instanceof MemberReviewError || error instanceof StoreAccessError || error instanceof StoreInputError ? error.status : ["P2002", "P2034"].includes(code) ? 409 : 503;
  const message = error instanceof MemberReviewError ? error.code : status === 400 ? "InvalidInput" : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "NotFound" : status === 409 ? "Conflict" : "TemporarilyUnavailable";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
