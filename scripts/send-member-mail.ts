import { loadEnvConfig } from "@next/env";
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "../src/lib/prisma";
import { decryptMailPayload } from "../src/lib/member/mail";

loadEnvConfig(process.cwd());

async function main() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const from = process.env.SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from) throw new Error("SMTP configuration unavailable.");
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: process.env.SMTP_USER && process.env.SMTP_PASSWORD ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  const db = getPrisma();
  // A crashed sender may have reached SMTP; close its lease without resending.
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
      return { expired: false as const, id, leaseId, attemptNumber, encryptedPayload: delivery.encryptedPayload };
    });
    if (!claimed) break;
    handled++;
    if (claimed.expired) continue;
    const payload = decryptMailPayload(claimed.encryptedPayload);
    try {
      await transport.sendMail({ from, ...payload });
      await db.$transaction(async (tx) => {
        await setTransactionSchema(tx);
        const now = new Date();
        await tx.emailDelivery.updateMany({ where: { id: claimed.id, leaseId: claimed.leaseId, status: "SENDING" }, data: { status: "ACCEPTED", acceptedAt: now, closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
        await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claimed.id, attemptNumber: claimed.attemptNumber } }, data: { result: "ACCEPTED", finishedAt: now } });
      });
    } catch {
      // SMTP errors after DATA can be ambiguous. Never resend automatically here.
      await db.$transaction(async (tx) => {
        await setTransactionSchema(tx);
        const now = new Date();
        await tx.emailDelivery.updateMany({ where: { id: claimed.id, leaseId: claimed.leaseId, status: "SENDING" }, data: { status: "UNKNOWN", closedAt: now, encryptedPayload: null, payloadKeyId: null, payloadExpiresAt: null, leaseId: null, leaseExpiresAt: null } });
        await tx.emailDeliveryAttempt.update({ where: { deliveryId_attemptNumber: { deliveryId: claimed.id, attemptNumber: claimed.attemptNumber } }, data: { result: "UNKNOWN", finishedAt: now, errorCode: "SMTP_UNCERTAIN" } });
      });
    }
  }
  await transport.close();
  await db.$disconnect();
  process.stdout.write(`processed ${handled} delivery requests\n`);
}
main().catch(() => { process.stderr.write("Mail delivery failed.\n"); process.exitCode = 1; });
