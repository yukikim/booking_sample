import test from "node:test";
import assert from "node:assert/strict";
import { onRequestError } from "../src/instrumentation";
test("server error event omits error, request headers, query values and IDs", () => {
  const sentinel = "private-token-and-email@example.test";
  const saved = console.error; const logs: string[] = [];
  console.error = (value: string) => logs.push(value);
  try {
    onRequestError(new Error(sentinel), { path: `/account/${sentinel}?token=${sentinel}`, method: "GET", headers: { authorization: sentinel, cookie: sentinel } }, { routerKind: "App Router", routePath: `/account/${sentinel}`, routeType: "render", renderSource: "react-server-components", revalidateReason: undefined });
  } finally { console.error = saved; }
  assert.deepEqual(logs.map(value => JSON.parse(value)), [{ event: "SERVER_REQUEST_ERROR", routeType: "render" }]);
  assert(!logs.join().includes(sentinel));
});
