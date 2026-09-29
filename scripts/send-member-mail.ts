import { loadEnvConfig } from "@next/env";
import { createResendSender } from "../src/lib/mail/provider";
import { runMailBatch } from "../src/lib/mail/worker";
import { getPrisma } from "../src/lib/prisma";

loadEnvConfig(process.cwd());

async function main() {
  const db = getPrisma();
  try {
    const result = await runMailBatch(createResendSender(), 100, db);
    process.stdout.write(`mail requests: ${JSON.stringify(result)}\n`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { process.stderr.write("Mail delivery failed.\n"); process.exitCode = 1; });
