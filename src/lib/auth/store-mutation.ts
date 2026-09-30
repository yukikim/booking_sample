import "server-only";

import { getToken } from "next-auth/jwt";
import type { Prisma } from "@/generated/prisma/client";
import { authEnvironment } from "./config";
import { StoreAccessError, type StoreAction } from "./permissions";
import { claimsFrom } from "./policy";
import { resolveSession } from "./session";

export class StoreInputError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code?: "ExistingPlanReviewPending" | "ReviewRequired") { super("InvalidInput"); }
}

export function checkMutationOrigin(request: Request) {
  if (request.headers.get("origin") !== authEnvironment().origin) throw new StoreAccessError(403);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new StoreInputError(400);
  if (Number(request.headers.get("content-length")) > 4096) throw new StoreInputError(400);
  const body = await request.text();
  if (body.length > 4096) throw new StoreInputError(400);
  try { return JSON.parse(body); } catch { throw new StoreInputError(400); }
}

export async function requireStoreMutation(tx: Prisma.TransactionClient, request: Request, action: StoreAction) {
  checkMutationOrigin(request);
  const env = authEnvironment();
  const cookie = request.headers.get("cookie") ?? "";
  const token = await getToken({ req: new Request(env.origin, { headers: { cookie } }), secret: env.secret, secureCookie: env.secure });
  const claims = claimsFrom(token);
  if (!claims) throw new StoreAccessError(401);
  if (claims.role === "MEMBER") throw new StoreAccessError(403);
  await tx.$queryRaw`SELECT id FROM "AppSession" WHERE id = ${claims.sid}::uuid FOR UPDATE`;
  if (claims.role === "ADMIN") await tx.$queryRaw`SELECT id FROM "AdminAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${claims.principalId}::uuid FOR UPDATE`;
  if (!await resolveSession(claims, new Date(), tx)) throw new StoreAccessError(401);
  if (claims.role === "ADMIN") return claims;
  if (action === "STAFF_PERMISSION_MANAGE" || action === "MEMBER_REVIEW") throw new StoreAccessError(403);
  if (action === "STORE_VIEW") return claims;
  const grant = await tx.staffPermission.findUnique({ where: { staffId_permission: { staffId: claims.principalId, permission: action } }, select: { staffId: true } });
  if (!grant) throw new StoreAccessError(403);
  return claims;
}

export function mutationFailure(error: unknown) {
  const status = error instanceof StoreAccessError || error instanceof StoreInputError ? error.status : (error && typeof error === "object" && "code" in error && error.code === "P2002" ? 409 : 503);
  const message = error instanceof StoreInputError && error.code ? error.code : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 400 ? "InvalidInput" : status === 404 ? "NotFound" : status === 409 ? "Conflict" : "TemporarilyUnavailable";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
