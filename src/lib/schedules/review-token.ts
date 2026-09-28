import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authEnvironment } from "@/lib/auth/config";

function signature(value: string) {
  return createHmac("sha256", authEnvironment().secret).update(value).digest("base64url");
}

/** A short-lived receipt for the exact server-calculated preview and actor. */
export function issueReviewToken(subject: unknown) {
  const digest = createHash("sha256").update(JSON.stringify(subject)).digest("base64url");
  const body = Buffer.from(JSON.stringify({ digest, issuedAt: Date.now() })).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function matchesReviewToken(token: unknown, subject: unknown) {
  if (typeof token !== "string" || token.length > 10_000) return false;
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra || !/^[A-Za-z0-9_-]+$/.test(body)) return false;
  const expected = signature(body);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { digest: string; issuedAt: number };
    const digest = createHash("sha256").update(JSON.stringify(subject)).digest("base64url");
    return Number.isSafeInteger(payload.issuedAt) && Date.now() >= payload.issuedAt && Date.now() - payload.issuedAt <= 10 * 60_000 && payload.digest === digest;
  } catch { return false; }
}
