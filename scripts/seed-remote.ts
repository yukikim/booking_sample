import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDevelopment } from "../prisma/seed-data";
import { RemoteSeedConfigurationError, remoteSeedArguments, remoteSeedConnection } from "./lib/remote-seed";

async function main() {
  const { file, host, database } = remoteSeedArguments(process.argv.slice(2));
  let env: Record<string, string>;
  try { env = parse(readFileSync(file)); }
  catch { throw new RemoteSeedConfigurationError("--file: environment file could not be read"); }
  // Use only this file; do not merge shell or local Next.js environment values.
  const connectionString = remoteSeedConnection(env, host, database);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 15_000 }, { schema: "public" }),
    // Sequential seed queries cross the network; allow more than the default 5s.
    transactionOptions: { maxWait: 15_000, timeout: 60_000 },
  });
  try {
    await seedDevelopment(prisma);
    console.log("Remote seed completed: admin, 2 rooms, 2 therapists, 3 treatments, 3 options, initial business/break schedules and store setting state. Existing values preserved.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof RemoteSeedConfigurationError) console.error(error.message);
  else {
    // Never print provider exception messages, URLs or credentials.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const hints: Record<string, string> = {
      P2028: "Seed transaction could not complete within its time limit. Check endpoint latency and database locks before retrying.",
      P2021: "Required table is missing. Apply migrations with db:deployment --action deploy first.",
      P2022: "Required column is missing. Check migration status and schema.",
      P1000: "Database authentication failed. Check the selected file's database credentials.",
      P1001: "Database endpoint could not be reached. Check network access and endpoint state.",
      P2002: "Existing data conflicts with a unique constraint. Inspect catalog data before retrying.",
    };
    if (/^P\d{4}$/.test(code)) console.error(`Remote seed error code: ${code}`);
    console.error(hints[code] ?? "Remote seed failed. Check connection, TLS, permissions and migration state locally; provider details are suppressed.");
  }
  process.exitCode = 1;
});
