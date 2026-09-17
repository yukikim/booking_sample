import { loadEnvConfig } from "@next/env";

async function main() {
  // Match `next dev`, including .env.local overrides. Never print env values.
  loadEnvConfig(process.cwd(), true);

  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Missing database configuration.");
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    (url.port || "5432") !== "5432" ||
    url.pathname !== "/booking_sample" ||
    [...url.searchParams.keys()].some((key) => key !== "schema") ||
    (url.searchParams.has("schema") &&
      url.searchParams.get("schema") !== "public")
  ) {
    throw new Error("Only the local Compose database is allowed.");
  }

  const { getPrisma } = await import("../src/lib/prisma");
  const prisma = getPrisma();
  try {
    if (getPrisma() !== prisma) throw new Error("Client is not shared.");
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    if (rows.length !== 1 || rows[0].ok !== 1) {
      throw new Error("Unexpected database response.");
    }
    console.log("Local PostgreSQL: SELECT 1 succeeded (shared Prisma Client).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Driver errors may contain connection strings or credentials.
  console.error(
    "DB check failed. Check the local Compose service and DATABASE_URL (.env overrides included).",
  );
  process.exitCode = 1;
});
