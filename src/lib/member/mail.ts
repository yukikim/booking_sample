import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { authEnvironment } from "@/lib/auth/config";

type Purpose = "MEMBERSHIP_CONFIRM" | "RESTORE_CONFIRM" | "PASSWORD_RESET";
const lifetime = { MEMBERSHIP_CONFIRM: 24 * 60 * 60_000, RESTORE_CONFIRM: 24 * 60 * 60_000, PASSWORD_RESET: 60 * 60_000 };

function payloadKey() {
  const key = Buffer.from(process.env.MAIL_PAYLOAD_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("Mail payload key unavailable.");
  return key;
}

export function tokenDigest(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function validRawToken(token: unknown): token is string { return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token); }

export type MailPayload = { from: string; to: string; subject: string; text: string };

export function configuredMailFrom() {
  const from = process.env.RESEND_FROM?.trim();
  if (!from || from.length > 320) throw new Error("Mail sender unavailable.");
  return from;
}

export function decryptMailPayload(encrypted: Uint8Array) {
  const bytes = Buffer.from(encrypted);
  const decipher = createDecipheriv("aes-256-gcm", payloadKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as MailPayload;
}

export function encryptMailPayload(value: MailPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", payloadKey(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
}

/** Token and encrypted delivery request are committed together; raw tokens never enter AuthToken. */
export async function issueMemberMail(tx: Prisma.TransactionClient, member: { id: string; email: string; emailKey: string; authVersion: number; restoreGeneration?: number }, purpose: Purpose) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + lifetime[purpose]);
  const path = purpose === "MEMBERSHIP_CONFIRM" ? "/confirm" : purpose === "RESTORE_CONFIRM" ? "/restore" : "/reset-password";
  const url = `${authEnvironment().origin}${path}#token=${token}`;
  const subject = purpose === "MEMBERSHIP_CONFIRM" ? "入会メールアドレスの確認" : purpose === "RESTORE_CONFIRM" ? "会員アカウントの復旧確認" : "パスワード再設定";
  const text = `${subject}の手続きを続けるには、次のリンクを開いてください。\n${url}\n有効期限を過ぎたリンクや使用済みのリンクは使えません。`;
  const encryptedPayload = encryptMailPayload({ from: configuredMailFrom(), to: member.email, subject, text });
  if (purpose === "RESTORE_CONFIRM" && (!member.restoreGeneration || member.restoreGeneration < 1)) throw new Error("Restore generation unavailable.");
  const created = await tx.authToken.create({ data: { digest: tokenDigest(token), purpose, memberId: member.id, emailKey: member.emailKey, authVersion: member.authVersion, ...(purpose === "RESTORE_CONFIRM" ? { restoreGeneration: member.restoreGeneration } : {}), createdAt: now, expiresAt } });
  const delivery = await tx.emailDelivery.create({ data: { requestKey: randomUUID(), kind: purpose, tokenId: created.id, tokenReferenceId: created.id, status: "PENDING", recipient: member.email, encryptedPayload, payloadKeyId: "v1", payloadExpiresAt: expiresAt, createdAt: now, nextAttemptAt: now } });
  return delivery.id;
}
