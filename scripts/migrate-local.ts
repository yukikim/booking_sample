import { loadDevelopmentDatabase, runPrisma } from "./lib/development-database";

try {
  const url = loadDevelopmentDatabase();
  runPrisma(["migrate", "deploy"], url);
  runPrisma(["migrate", "status"], url);
  console.log("Local migrations applied; migration status is up to date.");
} catch {
  console.error("Local migration failed. Check the Compose service, matching local URLs and migration history. No reset was requested.");
  process.exitCode = 1;
}
