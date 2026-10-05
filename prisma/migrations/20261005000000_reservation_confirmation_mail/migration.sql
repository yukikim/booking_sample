ALTER TYPE "EmailKind" ADD VALUE 'RESERVATION_CONFIRMED_MEMBER';
ALTER TYPE "EmailKind" ADD VALUE 'RESERVATION_CONFIRMED_ADMIN';
ALTER TABLE "EmailDelivery" ADD COLUMN "reservationId" UUID, ADD COLUMN "reservationVersion" INTEGER;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "EmailDelivery_reservationId_kind_key" ON "EmailDelivery"("reservationId", "kind");
ALTER TABLE "EmailDelivery" DROP CONSTRAINT "EmailDelivery_target_check";
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_target_check" CHECK (
  ("kind" IN ('RESERVATION_CONFIRMED_MEMBER','RESERVATION_CONFIRMED_ADMIN') AND "reservationId" IS NOT NULL AND "reservationVersion" IS NOT NULL AND "reservationVersion">=1 AND "noticeId" IS NULL AND "confirmationAuditId" IS NULL AND "tokenId" IS NULL AND "tokenReferenceId" IS NULL)
  OR ("kind"='RESERVATION_CHANGE' AND "reservationId" IS NULL AND "reservationVersion" IS NULL AND "noticeId" IS NOT NULL AND "confirmationAuditId" IS NOT NULL AND "tokenId" IS NULL AND "tokenReferenceId" IS NULL)
  OR ("kind" IN ('MEMBERSHIP_CONFIRM','RESTORE_CONFIRM','PASSWORD_RESET') AND "reservationId" IS NULL AND "reservationVersion" IS NULL AND "noticeId" IS NULL AND "confirmationAuditId" IS NULL AND "tokenReferenceId" IS NOT NULL AND ("tokenId" IS NULL OR "tokenId"="tokenReferenceId"))
);
ALTER TABLE "EmailDelivery" DROP CONSTRAINT "EmailDelivery_payload_check";
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_payload_check" CHECK ((("encryptedPayload" IS NULL AND "payloadKeyId" IS NULL AND "payloadExpiresAt" IS NULL) OR ("encryptedPayload" IS NOT NULL AND octet_length("encryptedPayload")>0 AND "payloadKeyId" IS NOT NULL AND btrim("payloadKeyId")<>'' AND "payloadExpiresAt" IS NOT NULL AND isfinite("payloadExpiresAt") AND "payloadExpiresAt">"createdAt")) AND ("recipient" IS NULL OR "recipient" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AND ("status" NOT IN ('PENDING','SENDING','RETRY_WAIT') OR ("recipient" IS NOT NULL AND ("kind" IN ('RESERVATION_CHANGE','RESERVATION_CONFIRMED_MEMBER','RESERVATION_CONFIRMED_ADMIN') OR ("tokenId" IS NOT NULL AND "encryptedPayload" IS NOT NULL)))) AND ("status" IN ('PENDING','SENDING','RETRY_WAIT') OR "encryptedPayload" IS NULL));
