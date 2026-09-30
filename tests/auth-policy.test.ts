import assert from "node:assert/strict";
import test from "node:test";
import { emailKey, validPassword, safeRedirect, claimsFrom } from "../src/lib/auth/policy";
import { hashPassword, verifyPassword, needsRehash } from "../src/lib/auth/password";

test("メール照合はASCII小文字化のみ。別名は統合しない", () => {
  assert.equal(emailKey(" A.B+Tag@EXAMPLE.TEST "), "a.b+tag@example.test");
  for (const input of ["あ@example.test", "a..b@example.test", "x@-example.test", "x@example", "x y@example.test"]) assert.equal(emailKey(input), null);
});
test("パスワードは15〜128コードポイント、空白も保持する", async () => {
  assert(!validPassword("a".repeat(14)));
  assert(validPassword("a".repeat(15)));
  assert(validPassword("😀".repeat(128)));
  assert(!validPassword("😀".repeat(129)));
  const password = "😀".repeat(126) + "  ";
  const encoded = await hashPassword(password);
  assert(await verifyPassword(encoded, password));
  assert(!await verifyPassword(encoded, password.trim()));
  assert(!needsRehash(encoded));
  assert.notEqual(encoded, await hashPassword(password));
});
test("外部・protocol-relative・未知の戻り先を許可しない", () => {
  for (const url of ["https://evil.test/manage", "//evil.test/manage", "/unknown", "/\\evil.test"]) assert.equal(safeRedirect(url, "https://booking.test"), "https://booking.test/manage");
  assert.equal(safeRedirect("/staff/login?token=secret", "https://booking.test"), "https://booking.test/staff/login");
  assert.equal(safeRedirect("/book?next=https://evil.test", "https://booking.test"), "https://booking.test/book");
  assert.equal(claimsFrom({ role: "MEMBER" }), null);
});
