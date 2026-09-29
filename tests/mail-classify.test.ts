import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyResendResponse } from "../src/lib/mail/classify";

test("Resendの確定応答だけを送信受付として扱う", () => {
  assert.equal(classifyResendResponse({ id: "sent" }, null).kind, "ACCEPTED");
  assert.equal(classifyResendResponse(null, { name: "rate_limit_exceeded", statusCode: 429 }).kind, "TRANSIENT");
  assert.equal(classifyResendResponse(null, { name: "concurrent_idempotent_requests", statusCode: 409 }).kind, "TRANSIENT");
  assert.equal(classifyResendResponse(null, { name: "internal_server_error", statusCode: 500 }).kind, "TRANSIENT");
  assert.equal(classifyResendResponse(null, { name: "invalid_from_address", statusCode: 422 }).kind, "PERMANENT");
  assert.equal(classifyResendResponse(null, { name: "application_error", statusCode: null }).kind, "UNKNOWN");
});
