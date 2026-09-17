import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

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

  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    max: 5,
  });
  const client = new PrismaClient({ adapter, log: [] });

  if (process.env.NODE_ENV === "production") {
    productionClient = client;
  } else {
    globalForPrisma.bookingPrisma = client;
  }

  return client;
}
