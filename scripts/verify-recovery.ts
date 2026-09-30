import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadDevelopmentDatabase, runPrisma } from "./lib/development-database";
import { seedDevelopment, seedIds } from "../prisma/seed-data";
import { postgresTool } from "./lib/postgres-backup";
import { quarantineRestoredDatabase } from "./lib/recovery";
import { operationsHealth } from "../src/lib/ops/health";

async function main() {
  const base = loadDevelopmentDatabase();
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const sourceName = `recovery_source_${suffix}`, restoredName = `recovery_restored_${suffix}`;
  const created: string[] = [];
  const work = mkdtempSync(join(tmpdir(), "booking-recovery-"));
  let source: PrismaClient | undefined, restored: PrismaClient | undefined, restoredPg: Client | undefined;
  const databaseURL = (name: string) => { const url = new URL(base); url.pathname = `/${name}`; return url.href; };
  try {
    for (const name of [sourceName, restoredName]) { await admin.query(`CREATE DATABASE "${name}"`); created.push(name); }
    const sourceUrl = databaseURL(sourceName), restoredUrl = databaseURL(restoredName);
    runPrisma(["migrate", "deploy"], sourceUrl);
    source = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }), log: [] });
    await seedDevelopment(source);
    const member = await source.member.create({ data: { email: "recovery@example.test", emailKey: "recovery@example.test", lastName: "復旧", firstName: "確認", lastNameKey: "復旧", firstNameKey: "確認", phoneNumber: "09000000000", postalCode: "0010000", ageBand: 30, passwordHash: "fixture-not-a-login-hash", status: "ACTIVE", emailVerifiedAt: new Date(), firstActivatedAt: new Date() } });
    const staff = await source.staffAccount.create({ data: { email: "staff@example.test", emailKey: "staff@example.test", displayName: "復旧担当", passwordHash: "fixture-not-a-login-hash", permissions: { create: { permission: "RESERVATION_CREATE", grantedByAdminId: seedIds.admin } } } });
    await source.member.create({ data: { email: "withdrawn@example.test", emailKey: "withdrawn@example.test", lastName: "退会", firstName: "確認", lastNameKey: "退会", firstNameKey: "確認", phoneNumber: "09000000001", postalCode: "0010000", ageBand: 30, passwordHash: "fixture-not-a-login-hash", status: "WITHDRAWN", isDeleted: true, emailVerifiedAt: new Date(), firstActivatedAt: new Date() } });
    await source.appSession.create({ data: { principalType: "STAFF", staffId: staff.id, authVersion: 1, expiresAt: new Date(Date.now() + 3600000) } });
    await source.appSession.create({ data: { principalType: "ADMIN", adminId: seedIds.admin, authVersion: 1, expiresAt: new Date(Date.now() + 3600000) } });
    const start = new Date("2026-12-01T00:00:00Z"), end = new Date("2026-12-01T01:00:00Z");
    const reservation = await source.reservation.create({ data: { memberId: member.id, treatmentId: seedIds.treatments[0], roomId: seedIds.rooms[0], therapistId: seedIds.therapists[0], memberLastNameSnapshot: member.lastName, memberFirstNameSnapshot: member.firstName, memberEmailSnapshot: member.email, memberPhoneNumberSnapshot: member.phoneNumber, treatmentNameSnapshot: "復旧検証", treatmentDurationMinutesSnapshot: 60, treatmentPriceYenSnapshot: 6000, roomNameSnapshot: "部屋", therapistNameSnapshot: "担当", businessDate: new Date("2026-12-01T00:00:00Z"), startsAt: start, treatmentEndsAt: end, occupiesUntil: end, totalDurationMinutes: 60, totalPriceYen: 6000, slotCount: 1, slots: { create: { slotStartsAt: start } } } });
    await source.appSession.create({ data: { principalType: "MEMBER", memberId: member.id, authVersion: 1, expiresAt: new Date(Date.now() + 3600000) } });
    const token = await source.authToken.create({ data: { digest: "a".repeat(64), purpose: "PASSWORD_RESET", memberId: member.id, emailKey: member.emailKey, authVersion: 1, expiresAt: new Date(Date.now() + 3600000) } });
    await source.emailDelivery.create({ data: { requestKey: randomUUID(), kind: "PASSWORD_RESET", tokenId: token.id, tokenReferenceId: token.id, recipient: member.email, encryptedPayload: Buffer.from("fixture"), payloadKeyId: "v1", payloadExpiresAt: new Date(Date.now() + 3600000), createdAt: new Date(Date.now() - 600000), nextAttemptAt: new Date(Date.now() - 600000) } });
    assert.equal((await operationsHealth(source)).status, "attention");
    await source.$disconnect(); source = undefined;
    const archive = join(work, "fixture.dump");
    postgresTool("pg_dump", sourceUrl, ["--format=custom", "--no-owner", "--no-acl", "--file", archive]);
    postgresTool("pg_restore", restoredUrl, ["--dbname", restoredName, "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", archive]);
    restored = new PrismaClient({ adapter: new PrismaPg({ connectionString: restoredUrl }), log: [] });
    assert.equal(await restored.reservation.count(), 1);
    assert.equal(await restored.reservationSlot.count(), 1);
    assert.equal(await restored.appSession.count({ where: { revokedAt: null } }), 3);
    assert.equal(await restored.member.count({ where: { status: "WITHDRAWN", isDeleted: true } }), 1);
    assert.equal(await restored.staffPermission.count({ where: { staffId: staff.id, permission: "RESERVATION_CREATE" } }), 1);
    restoredPg = new Client({ connectionString: restoredUrl }); await restoredPg.connect();
    await quarantineRestoredDatabase(restoredPg);
    await quarantineRestoredDatabase(restoredPg); // Safe to repeat during recovery.
    assert.equal(await restored.appSession.count({ where: { revokedAt: null } }), 0);
    assert.equal(await restored.authToken.count({ where: { revokedAt: null } }), 0);
    assert.equal(await restored.emailDelivery.count({ where: { status: "UNKNOWN", encryptedPayload: null } }), 1);
    assert.deepEqual(await restored.reservation.findUniqueOrThrow({ where: { id: reservation.id } }), reservation);
    assert.equal(await restored.reservationSlot.count(), 1);
    await assert.rejects(restored.reservationSlot.create({ data: { reservationId: reservation.id, roomId: seedIds.rooms[0], therapistId: seedIds.therapists[0], slotStartsAt: start } }));
    assert.equal((await operationsHealth(restored)).mail.unknown, 1);
    const migrations = await restoredPg.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    assert(migrations.rows[0].count > 0);
    console.log("Recovery drill passed: actual pg_dump/pg_restore, reservations/slots/constraints/migrations preserved, sessions/tokens revoked, mail quarantined, health detects overdue/unknown. Public DB untouched.");
  } finally {
    await source?.$disconnect(); await restored?.$disconnect(); await restoredPg?.end();
    for (const name of created.reverse()) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end(); rmSync(work, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("Recovery drill failed. Check local PostgreSQL and pg_dump/pg_restore versions; no credentials or records are logged."); process.exitCode = 1; });
