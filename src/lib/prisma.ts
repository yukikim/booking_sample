import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  bookingPrisma?: PrismaClient;
};

let productionClient: PrismaClient | undefined;

/** Create on first use, then share the pool across requests and dev reloads. */
export function getPrisma(): PrismaClient {
  const existing =
    process.env.NODE_ENV === "production"
      ? productionClient
      : globalForPrisma.bookingPrisma;
  if (existing) return existing;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    max: 5,
  }, { schema });
  const client = new PrismaClient({ adapter, log: [] });

  if (process.env.NODE_ENV === "production") {
    productionClient = client;
  } else {
    globalForPrisma.bookingPrisma = client;
  }

  return client;
}

/** Raw SQL follows the same schema as ORM queries, including isolated DB tests. */
export async function setTransactionSchema(tx: Prisma.TransactionClient) {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "public";
  const quoted = `"${schema.replaceAll('"', '""')}"`;
  await tx.$queryRaw`SELECT set_config('search_path', ${quoted}, true)`;
}
