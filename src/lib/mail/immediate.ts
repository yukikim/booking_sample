import "server-only";
import { after } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { createResendSender } from "./provider";
import { runMailBatch } from "./worker";

/** Start this request's delivery after its DB transaction commits and the response is sent. */
export function dispatchMailAfterResponse(deliveryId: string) {
  // The isolated HTTP tests use a fake API key and dispatch with an injected sender.
  if (process.env.AUTH_TEST_TSCONFIG && process.env.MAIL_TEST_DISABLE_IMMEDIATE === "1") return;
  after(async () => {
    try {
      await runMailBatch(createResendSender(), 1, getPrisma(), deliveryId);
    } catch {
      // The DB request stays pending for the scheduled worker.
      process.stderr.write("Immediate mail dispatch failed.\n");
    }
  });
}
