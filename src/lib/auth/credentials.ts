import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getPrisma, setTransactionSchema } from "../prisma";
import { adminEnvironment } from "./config";
import { ADMIN_ID, emailKey, validPassword, SESSION_SECONDS, type StoreRole } from "./policy";
import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password";
import { consumeLoginAttempt } from "./rate-limit";

export async function authenticate(role: StoreRole, credentials: Partial<Record<string, unknown>>, request: Request) {
  const email = emailKey(credentials.email);
  // Malformed input still consumes the IP bucket before expensive hashing.
  await consumeLoginAttempt(role, email ?? "invalid-input", request);
  if (!email || !validPassword(credentials.password)) return null;
  const password = credentials.password;
  const db = getPrisma();
  let principalId: string;
  let authVersion: number;
  let originalHash: string | undefined;
  let replacementHash: string | undefined;
  if (role === "ADMIN") {
    const configured = adminEnvironment();
    const digest = (text: string) => createHash("sha256").update(text).digest();
    const passwordMatches = timingSafeEqual(digest(password), digest(configured.password));
    if (!passwordMatches || email !== configured.email) return null;
    principalId = ADMIN_ID;
    authVersion = configured.version;
  } else {
    const staff = await db.staffAccount.findUnique({ where: { emailKey: email } });
    const encoded = staff?.passwordHash ?? await dummyHash();
    const matches = await verifyPassword(encoded, password);
    if (!matches || !staff?.isActive) return null;
    principalId = staff.id;
    authVersion = staff.authVersion;
    originalHash = staff.passwordHash;
    if (needsRehash(encoded)) replacementHash = await hashPassword(password);
  }
  return db.$transaction(async (tx) => {
    await setTransactionSchema(tx);
    // Lock the principal and recheck after hashing to reject concurrent credential changes.
    if (role === "ADMIN") {
      await tx.$queryRaw`SELECT id FROM "AdminAccount" WHERE id = ${principalId}::uuid FOR UPDATE`;
      const admin = await tx.adminAccount.findUnique({ where: { id: principalId } });
      if (!admin?.isActive || adminEnvironment().version !== authVersion) return null;
    } else {
      await tx.$queryRaw`SELECT id FROM "StaffAccount" WHERE id = ${principalId}::uuid FOR UPDATE`;
      const staff = await tx.staffAccount.findUnique({ where: { id: principalId } });
      if (!staff?.isActive || staff.authVersion !== authVersion || staff.passwordHash !== originalHash || staff.emailKey !== email) return null;
      if (replacementHash) await tx.staffAccount.update({ where: { id: principalId }, data: { passwordHash: replacementHash } });
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_SECONDS * 1000);
    const row = await tx.appSession.create({ data: { principalType: role, ...(role === "ADMIN" ? { adminId: principalId } : { staffId: principalId }), authVersion, createdAt, expiresAt } });
    return { id: principalId, principalId, role, authVersion, sid: row.id, absoluteExpiry: expiresAt.getTime() };
  });
}
