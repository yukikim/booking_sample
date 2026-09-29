import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/** Shared write barrier for reservations, settings, resources and withdrawal. */
export async function lockBookingState(tx: Prisma.TransactionClient) {
  await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
}
