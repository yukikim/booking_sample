import "server-only";
import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { emailKey, validPassword } from "@/lib/auth/policy";
import { hashPassword } from "@/lib/auth/password";
import { checkMutationOrigin, readJsonBody } from "@/lib/auth/store-mutation";
import { consumeMailRequest, consumeTokenAttempt, MailRateLimited, TokenRateLimited } from "@/lib/auth/rate-limit";
import { issueMemberMail, tokenDigest, validRawToken } from "./mail";
import { dispatchMailAfterResponse } from "@/lib/mail/immediate";
import { parseRegistration } from "./identity";

export class MemberInputError extends Error { constructor(readonly status: 400 | 409 = 400) { super("Invalid member operation"); } }
const accepted = () => Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });

export async function registerMember(request: Request) {
  checkMutationOrigin(request);
  const input = parseRegistration(await readJsonBody(request));
  if (!input) throw new MemberInputError();
  if (!await consumeMailRequest(input.emailKey, request)) return accepted();
  const hash = await hashPassword(input.password);
  try {
    const deliveryId = await getPrisma().$transaction(async (tx) => {
      await setTransactionSchema(tx);
      if (await tx.member.findUnique({ where: { emailKey: input.emailKey }, select: { id: true } })) return null;
      const member = await tx.member.create({ data: { email: input.email, emailKey: input.emailKey, lastName: input.lastName, firstName: input.firstName, lastNameKey: input.lastNameKey, firstNameKey: input.firstNameKey, phoneNumber: input.phoneNumber, postalCode: input.postalCode, ageBand: input.ageBand, passwordHash: hash, status: "PENDING_EMAIL" } });
      return issueMemberMail(tx, member, "MEMBERSHIP_CONFIRM");
    });
    if (deliveryId) dispatchMailAfterResponse(deliveryId);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
  }
  return accepted();
}

export async function requestMemberLink(request: Request, purpose: "MEMBERSHIP_CONFIRM" | "RESTORE_CONFIRM" | "PASSWORD_RESET") {
  checkMutationOrigin(request);
  const body = await readJsonBody(request);
  const key = emailKey(body && typeof body === "object" && "email" in body ? body.email : null);
  if (!key) throw new MemberInputError();
  if (!await consumeMailRequest(key, request)) return accepted();
  const deliveryId = await getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const existing = await tx.member.findUnique({ where: { emailKey: key }, select: { id: true } });
    if (!existing) return null;
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${existing.id}::uuid FOR UPDATE`;
    const member = await tx.member.findUniqueOrThrow({ where: { id: existing.id } });
    const eligible = purpose === "MEMBERSHIP_CONFIRM" ? member.status === "PENDING_EMAIL" && !member.isDeleted : purpose === "RESTORE_CONFIRM" ? member.status === "RESTORE_PENDING" && member.isDeleted && !!member.firstActivatedAt : member.status === "ACTIVE" && !member.isDeleted && !!member.emailVerifiedAt;
    if (!eligible) return null;
    const now = new Date();
    await tx.authToken.updateMany({ where: { memberId: member.id, purpose, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.emailDelivery.updateMany({ where: { token: { memberId: member.id, purpose, revokedAt: { not: null } }, status: { in: ["PENDING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, closedAt: now, nextAttemptAt: null } });
    return issueMemberMail(tx, member, purpose);
  });
  if (deliveryId) dispatchMailAfterResponse(deliveryId);
  return accepted();
}

export async function consumeMemberLink(request: Request, purpose: "MEMBERSHIP_CONFIRM" | "RESTORE_CONFIRM" | "PASSWORD_RESET") {
  checkMutationOrigin(request);
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || !("token" in body) || !("password" in body) || !validRawToken(body.token) || !validPassword(body.password)) throw new MemberInputError();
  await consumeTokenAttempt(request);
  const hash = await hashPassword(body.password);
  const digest = tokenDigest(body.token);
  const result = await getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const found = await tx.authToken.findUnique({ where: { digest }, select: { id: true, memberId: true } });
    if (!found?.memberId) return false;
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${found.memberId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AuthToken" WHERE id = ${found.id}::uuid FOR UPDATE`;
    const token = await tx.authToken.findUniqueOrThrow({ where: { id: found.id } });
    const member = await tx.member.findUniqueOrThrow({ where: { id: found.memberId } });
    const [{ now }] = await tx.$queryRaw<{now: Date}[]>`SELECT clock_timestamp() AS now`;
    const eligible = purpose === "MEMBERSHIP_CONFIRM" ? member.status === "PENDING_EMAIL" && !member.isDeleted : purpose === "RESTORE_CONFIRM" ? member.status === "RESTORE_PENDING" && member.isDeleted && !!member.firstActivatedAt && token.restoreGeneration === member.restoreGeneration : member.status === "ACTIVE" && !member.isDeleted && !!member.emailVerifiedAt;
    if (token.purpose !== purpose || token.usedAt || token.revokedAt || token.expiresAt <= now || token.emailKey !== member.emailKey || token.authVersion !== member.authVersion || !eligible) return false;
    const consumed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumed.count !== 1) return false;
    let reviewMatches: {id: string}[] = [];
    if (purpose === "MEMBERSHIP_CONFIRM") reviewMatches = await tx.member.findMany({ where: { id: { not: member.id }, lastNameKey: member.lastNameKey, firstNameKey: member.firstNameKey, isDeleted: true, status: { in: ["WITHDRAWN", "RESTORE_PENDING"] } }, select: { id: true } });
    await tx.member.update({ where: { id: member.id }, data: { passwordHash: hash, authVersion: { increment: 1 }, ...(purpose === "MEMBERSHIP_CONFIRM" ? { emailVerifiedAt: now, status: reviewMatches.length ? "PENDING_REVIEW" : "ACTIVE", ...(reviewMatches.length ? {} : { firstActivatedAt: now }) } : purpose === "RESTORE_CONFIRM" ? { status: "ACTIVE", isDeleted: false, emailVerifiedAt: now, version: { increment: 1 } } : {}) } });
    if (purpose === "RESTORE_CONFIRM") {
      const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: "SYSTEM", action: "MEMBER_RESTORE_COMPLETED", targetType: "Member", targetId: member.id, changes: { restoreGeneration: member.restoreGeneration } } });
      await tx.memberLifecycleEvent.create({ data: { memberId: member.id, kind: "RESTORE_COMPLETED", restoreGeneration: member.restoreGeneration, auditId: audit.id } });
    }
    if (reviewMatches.length) await tx.memberReview.create({ data: { memberId: member.id, matches: { create: reviewMatches.map((match) => ({ matchedMemberId: match.id })) } } });
    await tx.authToken.updateMany({ where: { memberId: member.id, id: { not: token.id }, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.appSession.updateMany({ where: { memberId: member.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.emailDelivery.updateMany({ where: { tokenId: token.id, status: { in: ["PENDING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, closedAt: now, nextAttemptAt: null } });
    return true;
  });
  if (!result) throw new MemberInputError(409);
  return Response.json({ completed: true }, { headers: { "Cache-Control": "no-store" } });
}

export function memberFailure(error: unknown) {
  const status = error instanceof MailRateLimited || error instanceof TokenRateLimited ? 429 : error instanceof MemberInputError ? error.status : error && typeof error === "object" && "status" in error && (error.status === 400 || error.status === 403) ? error.status : 503;
  return Response.json({ error: status === 429 ? "RateLimited" : status === 409 ? "InvalidOrExpiredLink" : status === 403 ? "Forbidden" : status === 400 ? "InvalidInput" : "TemporarilyUnavailable" }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": error instanceof TokenRateLimited ? "900" : "3600" } : {}) } });
}
