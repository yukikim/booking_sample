import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadDevelopmentDatabase } from "../scripts/lib/development-database";
import { seedDevelopment } from "./seed-data";

async function main() {
  const connectionString = loadDevelopmentDatabase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: "public" }) });
  try {
    await seedDevelopment(prisma);
    console.log("Local seed completed: admin, 2 rooms, 2 therapists, 3 treatments, 3 options, initial business/break schedules and store setting state. Existing values preserved.");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error("Local seed failed. Check matching local URLs and run db:migrate first.");
  process.exitCode = 1;
});
