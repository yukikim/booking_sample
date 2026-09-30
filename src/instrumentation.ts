import type { Instrumentation } from "next";
/** Deliberately omit exceptions, request paths/headers and dynamic route values. */
export const onRequestError: Instrumentation.onRequestError = (_error, _request, context) => {
  console.error(JSON.stringify({ event: "SERVER_REQUEST_ERROR", routeType: context.routeType }));
};
