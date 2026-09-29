import { loadEnvConfig } from "@next/env";
import { Resend } from "resend";

loadEnvConfig(process.cwd());

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM?.trim();
  const domain = from?.match(/@([A-Za-z0-9.-]+)>?$/)?.[1]?.toLowerCase();
  if (!apiKey || !domain) { process.stdout.write("sender configuration: missing\n"); process.exitCode = 1; return; }
  if (domain === "resend.dev") { process.stdout.write("sender domain: Resend test sender; custom domain not verified\n"); process.exitCode = 1; return; }
  const resend = new Resend(apiKey);
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await resend.domains.list(after ? { limit: 100, after } : { limit: 100 });
    if (result.error || !result.data) throw new Error(result.error?.statusCode === null ? "NETWORK" : `API_${result.error?.statusCode ?? "UNKNOWN"}`);
    const found = result.data.data.find((item) => item.name.toLowerCase() === domain);
    if (found) {
      const verified = found.status === "verified" && found.capabilities.sending === "enabled";
      process.stdout.write(`sender domain: ${verified ? "verified for sending" : "not verified for sending"}\n`);
      if (!verified) process.exitCode = 1;
      return;
    }
    if (!result.data.has_more || !result.data.data.length) break;
    after = result.data.data.at(-1)!.id;
  }
  process.stdout.write("sender domain: not present in this Resend account\n");
  process.exitCode = 1;
}
main().catch((error) => { const code = error instanceof Error && /^(NETWORK|API_[0-9]+|API_UNKNOWN)$/.test(error.message) ? error.message : "UNAVAILABLE"; process.stderr.write(`Sender-domain check unavailable (${code}).\n`); process.exitCode = 1; });
