import "server-only";
import { Resend } from "resend";
import type { MailSender, SendResult } from "./worker";
import { classifyResendResponse } from "./classify";

export function createResendSender(): MailSender {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend configuration unavailable.");
  const resend = new Resend(apiKey);
  return async (payload, requestKey): Promise<SendResult> => {
    const { data, error } = await resend.emails.send(payload, { idempotencyKey: requestKey });
    return classifyResendResponse(data, error);
  };
}
