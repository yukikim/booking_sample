export const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
export const SESSION_SECONDS = 8 * 60 * 60;
export const MEMBER_SESSION_SECONDS = 7 * 24 * 60 * 60;
export type StoreRole = "ADMIN" | "STAFF" | "MEMBER";
export type SessionClaims = {
  sid: string;
  principalId: string;
  role: StoreRole;
  authVersion: number;
  absoluteExpiry: number;
};

export function emailKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length > 254 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) return null;
  return email.toLowerCase();
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && [...value].length >= 15 && [...value].length <= 128;
}

export function claimsFrom(value: unknown): SessionClaims | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<SessionClaims>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof c.sid !== "string" || !uuid.test(c.sid) || typeof c.principalId !== "string" || !uuid.test(c.principalId) || (c.role !== "ADMIN" && c.role !== "STAFF" && c.role !== "MEMBER") || !Number.isSafeInteger(c.authVersion) || c.authVersion! < 1 || !Number.isSafeInteger(c.absoluteExpiry)) return null;
  return c as SessionClaims;
}

export function safeRedirect(url: string, baseUrl: string): string {
  try {
    const target = new URL(url, baseUrl);
    if (target.origin === new URL(baseUrl).origin && ["/manage", "/admin/login", "/staff/login", "/login", "/account", "/book"].includes(target.pathname)) return `${target.origin}${target.pathname}`;
  } catch { /* Use the fixed destination. */ }
  return `${baseUrl}/manage`;
}
