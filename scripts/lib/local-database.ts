/** Only permit the local Compose target in the development smoke check. */
export function assertLocalDatabase(value: string | undefined): void {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      (url.port || "5432") !== "5432" ||
      url.pathname !== "/booking_sample" ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "schema") ||
      url.searchParams.getAll("schema").length > 1 ||
      (url.searchParams.has("schema") &&
        url.searchParams.get("schema") !== "public")
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("Only the local Compose database is allowed.");
  }
}
