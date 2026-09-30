import type { Client } from "pg";
/** Run on an isolated restored DB with application/Cron disconnected. */
export async function quarantineRestoredDatabase(db: Client) {
  await db.query("BEGIN");
  try {
    await db.query('UPDATE "AppSession" SET "revokedAt" = clock_timestamp() WHERE "revokedAt" IS NULL');
    await db.query('UPDATE "AuthToken" SET "revokedAt" = clock_timestamp() WHERE "revokedAt" IS NULL');
    // A restored sending/pending request may already have been delivered after backup.
    await db.query(`UPDATE "EmailDelivery" SET status='UNKNOWN', "closedAt"=clock_timestamp(), "nextAttemptAt"=NULL, "leaseId"=NULL, "leaseExpiresAt"=NULL, "encryptedPayload"=NULL, "payloadKeyId"=NULL, "payloadExpiresAt"=NULL WHERE status IN ('PENDING','RETRY_WAIT','SENDING')`);
    await db.query('UPDATE "EmailDeliveryAttempt" SET result=\'UNKNOWN\', "finishedAt"=clock_timestamp(), "errorCode"=\'RESTORED_DATABASE\' WHERE result=\'STARTED\'');
    await db.query("COMMIT");
  } catch { await db.query("ROLLBACK"); throw new Error("Recovery quarantine failed."); }
}
