export type ProviderOutcome = { kind: "ACCEPTED" | "TRANSIENT" | "PERMANENT" | "UNKNOWN"; code?: "RATE_LIMITED" | "PROVIDER_TEMPORARY" | "PROVIDER_REJECTED" | "NETWORK_UNCERTAIN" };

export function classifyResendResponse(data: { id: string } | null, error: { name: string; statusCode: number | null } | null): ProviderOutcome {
  if (data?.id) return { kind: "ACCEPTED" };
  if (!error || error.statusCode === null) return { kind: "UNKNOWN", code: "NETWORK_UNCERTAIN" };
  if (error.name === "concurrent_idempotent_requests" || error.name === "rate_limit_exceeded" || error.statusCode === 429) return { kind: "TRANSIENT", code: "RATE_LIMITED" };
  if (error.statusCode >= 500) return { kind: "TRANSIENT", code: "PROVIDER_TEMPORARY" };
  return { kind: "PERMANENT", code: "PROVIDER_REJECTED" };
}
