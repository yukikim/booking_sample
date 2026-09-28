import { hash, verify, parseOptions, type Options } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { validPassword } from "./policy";

// Argon2id = 2, version 0x13 = 1 (the package exports ambient const enums).
const options: Options = { algorithm: 2, version: 1, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
let dummy: Promise<string> | undefined;
export function hashPassword(password: string) {
  if (!validPassword(password)) throw new Error("Invalid password length.");
  return hash(password, options);
}
export function dummyHash() {
  return dummy ??= hash(randomBytes(32).toString("hex"), options);
}
export async function verifyPassword(encoded: string, password: string) {
  try { return await verify(encoded, password); } catch { return false; }
}
export function needsRehash(encoded: string) {
  const old = parseOptions(encoded);
  return old.algorithm !== options.algorithm || old.version !== options.version || old.memoryCost < 19456 || old.timeCost < 2 || old.parallelism !== 1 || old.outputLen < 32 || old.saltLen < 16;
}
