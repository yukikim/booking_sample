import "server-only";

import { requireStoreAction } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";

export async function getStaffRoster() {
  await requireStoreAction("STAFF_PERMISSION_MANAGE");
  return getPrisma().staffAccount.findMany({
    select: { id: true, displayName: true, email: true, isActive: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
}
