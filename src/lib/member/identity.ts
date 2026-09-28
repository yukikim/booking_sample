import { emailKey, validPassword } from "@/lib/auth/policy";

export type Registration = { email: string; emailKey: string; lastName: string; firstName: string; lastNameKey: string; firstNameKey: string; phoneNumber: string; postalCode: string; ageBand: number; password: string };

export function nameKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function parseRegistration(value: unknown): Registration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const key = emailKey(input.email);
  if (!key || typeof input.lastName !== "string" || typeof input.firstName !== "string" || typeof input.phoneNumber !== "string" || typeof input.postalCode !== "string" || !validPassword(input.password)) return null;
  const lastName = input.lastName.trim();
  const firstName = input.firstName.trim();
  const phoneNumber = input.phoneNumber;
  const postalCode = input.postalCode.replace(/-/g, "");
  if (!lastName || !firstName || [...lastName].length > 100 || [...firstName].length > 100 || /[\p{Cc}\p{Cf}]/u.test(lastName + firstName) || !/^\d{10,11}$/.test(phoneNumber) || !/^\d{7}$/.test(postalCode) || ![20, 30, 40, 50, 60, 70, 80].includes(input.ageBand as number)) return null;
  return { email: (input.email as string).trim(), emailKey: key, lastName, firstName, lastNameKey: nameKey(lastName), firstNameKey: nameKey(firstName), phoneNumber, postalCode, ageBand: input.ageBand as number, password: input.password };
}
