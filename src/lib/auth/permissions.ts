import "server-only";

import { getStoreSession, AuthUnavailable } from "@/auth";
import { StaffPermissionKey } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";

export type StoreAction = StaffPermissionKey | "STORE_VIEW" | "STAFF_PERMISSION_MANAGE";
export type StorePrincipal = { id: string; role: "ADMIN" | "STAFF"; expires: string };

const permissionKeys = new Set<string>(Object.values(StaffPermissionKey));

export class StoreAccessError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super(status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "TemporarilyUnavailable");
  }
}

function validAction(action: string): action is StoreAction {
  return action === "STORE_VIEW" || action === "STAFF_PERMISSION_MANAGE" || permissionKeys.has(action);
}

/** Call at each server entry point. The UI and JWT never supply effective permissions. */
export async function requireStoreAction(action: StoreAction): Promise<StorePrincipal> {
  if (!validAction(action)) throw new StoreAccessError(403);
  let session;
  try {
    session = await getStoreSession();
  } catch (error) {
    if (error instanceof AuthUnavailable) throw new StoreAccessError(503);
    throw error;
  }
  if (!session) throw new StoreAccessError(401);

  const principal: StorePrincipal = {
    id: session.user.id,
    role: session.user.role,
    expires: session.expires,
  };
  if (action === "STORE_VIEW" || principal.role === "ADMIN") return principal;
  if (action === "STAFF_PERMISSION_MANAGE") throw new StoreAccessError(403);

  try {
    const grant = await getPrisma().staffPermission.findUnique({
      where: { staffId_permission: { staffId: principal.id, permission: action } },
      select: { staffId: true },
    });
    if (!grant) throw new StoreAccessError(403);
    return principal;
  } catch (error) {
    if (error instanceof StoreAccessError) throw error;
    throw new StoreAccessError(503);
  }
}

/** Display hints only; writes must call requireStoreAction with a server-owned key. */
export async function getStoreCapabilities() {
  const principal = await requireStoreAction("STORE_VIEW");
  if (principal.role === "ADMIN") {
    return { principal, permissions: Object.values(StaffPermissionKey), canManagePermissions: true };
  }
  try {
    const grants = await getPrisma().staffPermission.findMany({
      where: { staffId: principal.id },
      select: { permission: true },
      orderBy: { permission: "asc" },
    });
    return { principal, permissions: grants.map((grant) => grant.permission), canManagePermissions: false };
  } catch {
    throw new StoreAccessError(503);
  }
}
