import "server-only";
import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { requireStoreAction } from "@/lib/auth/permissions";
import { requireStoreMutation, readJsonBody, checkMutationOrigin, StoreInputError } from "@/lib/auth/store-mutation";
import { consumeMailRequest } from "@/lib/auth/rate-limit";
import { issueMemberMail } from "./mail";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function beginMemberRestore(request: Request, memberId: string) {
  checkMutationOrigin(request);
  if (!uuid.test(memberId)) throw new StoreInputError(400);
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StoreInputError(400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["expectedVersion", "reason"].includes(key)) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1 || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000) throw new StoreInputError(400);
  const reason = input.reason as string;
  await requireStoreAction("MEMBER_RESTORE");
  const target = await getPrisma().member.findUnique({ where: { id: memberId }, select: { emailKey: true } });
  if (!target) throw new StoreInputError(404);
  if (!await consumeMailRequest(target.emailKey, request)) throw new StoreInputError(409);
  return getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const claims = await requireStoreMutation(tx, request, "MEMBER_RESTORE");
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${memberId}::uuid FOR UPDATE`;
    const member = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
    if (member.version !== input.expectedVersion || member.status !== "WITHDRAWN" || !member.isDeleted || !member.firstActivatedAt) throw new StoreInputError(409);
    const next = await tx.member.update({ where: { id: memberId }, data: { status: "RESTORE_PENDING", restoreGeneration: { increment: 1 }, authVersion: { increment: 1 }, version: { increment: 1 } } });
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: claims.role, ...(claims.role === "ADMIN" ? { actorAdminId: claims.principalId } : { actorStaffId: claims.principalId }), action: "MEMBER_RESTORE_REQUESTED", targetType: "Member", targetId: memberId, changes: { reason: reason.trim(), restoreGeneration: next.restoreGeneration } } });
    await tx.memberLifecycleEvent.create({ data: { memberId, kind: "RESTORE_REQUESTED", reason: reason.trim(), restoreGeneration: next.restoreGeneration, auditId: audit.id } });
    await tx.authToken.updateMany({ where: { memberId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.appSession.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: new Date() } });
    await issueMemberMail(tx, next, "RESTORE_CONFIRM");
    return { status: next.status, version: next.version };
  });
}
