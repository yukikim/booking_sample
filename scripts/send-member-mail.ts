import { loadEnvConfig } from "@next/env";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "../src/lib/prisma";
import { decryptMailPayload } from "../src/lib/member/mail";

loadEnvConfig(process.cwd());

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) throw new Error("Resend configuration unavailable.");
  const resend = new Resend(apiKey);
  const db = getPrisma();
  // A crashed sender may have reached Resend; close its lease without resending.
  await db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const stale = await tx.emailDelivery.findMany({ where: { status: "SENDING", leaseExpiresAt: { lt: new Date() } }, select: { id: true, attemptCount: true } });
    for (const delivery of stale) {
      const now = new Date();
      await tx.emailDelivery.update({ where: { id: delivery.id }, data: { status: "UNKNOWN", closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
      await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: delivery.id, attemptNumber: delivery.attemptCount } }, data: { result: "UNKNOWN", finishedAt: now, errorCode: "LEASE_EXPIRED" } });
    }
  });
  let handled = 0;
  while (handled < 100) {
    const claimed = await db.$transaction(async (tx) => {
      await setTransactionSchema(tx);
      const rows = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "EmailDelivery" WHERE status IN ('PENDING','RETRY_WAIT') AND "nextAttemptAt" <= clock_timestamp() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const id = rows[0].id;
      const delivery = await tx.emailDelivery.findUniqueOrThrow({ where: { id }, include: { token: true } });
      const now = new Date();
      const token = delivery.token;
      if (!token || token.usedAt || token.revokedAt || token.expiresAt <= now || !delivery.encryptedPayload || !delivery.payloadExpiresAt || delivery.payloadExpiresAt <= now) {
        await tx.emailDelivery.update({ where: { id }, data: { status: "EXPIRED", encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, closedAt: now, nextAttemptAt: null } });
        return { expired: true as const };
      }
      const leaseId = randomUUID();
      const attemptNumber = delivery.attemptCount + 1;
      await tx.emailDelivery.update({ where: { id }, data: { status: "SENDING", leaseId, leaseExpiresAt: new Date(now.getTime() + 60_000), attemptCount: attemptNumber, nextAttemptAt: null } });
      await tx.emailDeliveryAttempt.create({ data: { deliveryId: id, attemptNumber, leaseId, startedAt: now } });
      return { expired: false as const, id, requestKey: delivery.requestKey, leaseId, attemptNumber, encryptedPayload: delivery.encryptedPayload };
    });
    if (!claimed) break;
    handled++;
    if (claimed.expired) continue;
    const payload = decryptMailPayload(claimed.encryptedPayload);
    try {
      const { data, error } = await resend.emails.send({ from, ...payload }, { idempotencyKey: claimed.requestKey });
      if (error || !data) throw new Error("Resend request was not accepted.");
      await db.$transaction(async (tx) => {
        await setTransactionSchema(tx);
        const now = new Date();
        await tx.emailDelivery.updateMany({ where: { id: claimed.id, leaseId: claimed.leaseId, status: "SENDING" }, data: { status: "ACCEPTED", acceptedAt: now, closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
        await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claimed.id, attemptNumber: claimed.attemptNumber } }, data: { result: "ACCEPTED", finishedAt: now } });
      });
    } catch {
      // Network failures can leave the Resend result ambiguous. Never resend automatically here.
      await db.$transaction(async (tx) => {
        await setTransactionSchema(tx);
        const now = new Date();
        await tx.emailDelivery.updateMany({ where: { id: claimed.id, leaseId: claimed.leaseId, status: "SENDING" }, data: { status: "UNKNOWN", closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
        await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claimed.id, attemptNumber: claimed.attemptNumber } }, data: { result: "UNKNOWN", finishedAt: now, errorCode: "RESEND_UNCERTAIN" } });
      });
    }
  }
  await db.$disconnect();
  process.stdout.write(`processed ${handled} delivery requests\n`);
}
main().catch(() => { process.stderr.write("Mail delivery failed.\n"); process.exitCode = 1; });
