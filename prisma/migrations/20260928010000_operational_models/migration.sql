BEGIN;

-- CreateEnum
CREATE TYPE "StaffPermissionKey" AS ENUM ('RESERVATION_CREATE', 'RESERVATION_UPDATE', 'RESERVATION_CANCEL', 'RESERVATION_EXCEPTION', 'RESERVATION_START', 'RESERVATION_COMPLETE', 'TREATMENT_CREATE', 'TREATMENT_UPDATE', 'TREATMENT_DISABLE', 'OPTION_CREATE', 'OPTION_UPDATE', 'OPTION_DISABLE', 'ROOM_CREATE', 'ROOM_UPDATE', 'ROOM_DISABLE', 'THERAPIST_CREATE', 'THERAPIST_UPDATE', 'THERAPIST_DISABLE', 'BUSINESS_SETTING_MANAGE', 'THERAPIST_BREAK_MANAGE', 'STAFF_CREATE', 'MEMBER_FORCE_WITHDRAW', 'MEMBER_DELETE', 'MEMBER_RESTORE', 'NOTICE_SEND', 'NOTICE_UPDATE_RESPONSE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('MEMBER', 'STAFF', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('MEMBERSHIP_CONFIRM', 'RESTORE_CONFIRM', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "MemberEventKind" AS ENUM ('VOLUNTARY_WITHDRAWAL', 'FORCED_WITHDRAWAL', 'RESTORE_REQUESTED', 'RESTORE_COMPLETED', 'RESTORE_CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('PENDING', 'DIFFERENT_PERSON', 'SAME_PERSON');

-- CreateEnum
CREATE TYPE "CancellationKind" AS ENUM ('NORMAL', 'STORE_EXCEPTION', 'MEMBER_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "NoticeResponseStatus" AS ENUM ('UNCONTACTED', 'AWAITING_CUSTOMER', 'IN_PROGRESS', 'IMPACT_RESOLVED_PENDING_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('MEMBERSHIP_CONFIRM', 'RESTORE_CONFIRM', 'PASSWORD_RESET', 'RESERVATION_CHANGE');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'RETRY_WAIT', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmailAttemptResult" AS ENUM ('STARTED', 'ACCEPTED', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RateLimitScope" AS ENUM ('MAIL_ADDRESS', 'MAIL_IP', 'LOGIN_ACCOUNT', 'LOGIN_IP', 'TOKEN_IP');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "restoreGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "actualCompletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "actualStartedAt" TIMESTAMPTZ(3),
ADD COLUMN     "cancellationAuditId" UUID,
ADD COLUMN     "cancellationKind" "CancellationKind",
ADD COLUMN     "cancellationReason" VARCHAR(1000),
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "StaffPermission" (
    "staffId" UUID NOT NULL,
    "permission" "StaffPermissionKey" NOT NULL,
    "grantedByAdminId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("staffId","permission")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "memberId" UUID,
    "staffId" UUID,
    "emailKey" VARCHAR(254) NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "restoreGeneration" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberLifecycleEvent" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "kind" "MemberEventKind" NOT NULL,
    "reason" VARCHAR(1000),
    "restoreGeneration" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditId" UUID NOT NULL,

    CONSTRAINT "MemberLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberReview" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(1000),
    "reviewedByAdminId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "decisionAuditId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberReviewMatch" (
    "reviewId" UUID NOT NULL,
    "matchedMemberId" UUID NOT NULL,

    CONSTRAINT "MemberReviewMatch_pkey" PRIMARY KEY ("reviewId","matchedMemberId")
);

-- CreateTable
CREATE TABLE "BusinessSchedule" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDay" (
    "scheduleId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "opensAt" TIME(0),
    "closesAt" TIME(0) NOT NULL,

    CONSTRAINT "BusinessDay_pkey" PRIMARY KEY ("scheduleId","weekday")
);

-- CreateTable
CREATE TABLE "TherapistSchedule" (
    "id" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapistSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistBreak" (
    "scheduleId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startsAt" TIME(0),
    "endsAt" TIME(0),

    CONSTRAINT "TherapistBreak_pkey" PRIMARY KEY ("scheduleId","weekday")
);

-- CreateTable
CREATE TABLE "ReservationChangeNotice" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "changeAuditId" UUID NOT NULL,
    "reservationVersion" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "proposedChange" JSONB,
    "responseStatus" "NoticeResponseStatus" NOT NULL DEFAULT 'UNCONTACTED',
    "responseNote" VARCHAR(1000),
    "resolvedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservationChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "tokenId" UUID,
    "tokenReferenceId" UUID,
    "noticeId" UUID,
    "confirmationAuditId" UUID,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" VARCHAR(254),
    "encryptedPayload" BYTEA,
    "payloadKeyId" VARCHAR(100),
    "payloadExpiresAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "leaseId" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "leaseId" UUID NOT NULL,
    "result" "EmailAttemptResult" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(100),

    CONSTRAINT "EmailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorMemberId" UUID,
    "actorStaffId" UUID,
    "actorAdminId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(100) NOT NULL,
    "targetId" UUID NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "scope" "RateLimitScope" NOT NULL,
    "keyDigest" VARCHAR(64) NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("scope","keyDigest")
);

-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" UUID NOT NULL,
    "scope" "RateLimitScope" NOT NULL,
    "keyDigest" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPermission_grantedByAdminId_idx" ON "StaffPermission"("grantedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_digest_key" ON "AuthToken"("digest");

-- CreateIndex
CREATE INDEX "AuthToken_memberId_purpose_createdAt_idx" ON "AuthToken"("memberId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthToken_staffId_purpose_createdAt_idx" ON "AuthToken"("staffId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLifecycleEvent_auditId_key" ON "MemberLifecycleEvent"("auditId");

-- CreateIndex
CREATE INDEX "MemberLifecycleEvent_memberId_createdAt_idx" ON "MemberLifecycleEvent"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemberReview_decisionAuditId_key" ON "MemberReview"("decisionAuditId");

-- CreateIndex
CREATE INDEX "MemberReview_memberId_createdAt_idx" ON "MemberReview"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberReview_decision_createdAt_idx" ON "MemberReview"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "MemberReview_reviewedByAdminId_idx" ON "MemberReview"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "MemberReviewMatch_matchedMemberId_idx" ON "MemberReviewMatch"("matchedMemberId");

-- CreateIndex
CREATE INDEX "TherapistSchedule_therapistId_idx" ON "TherapistSchedule"("therapistId");

-- CreateIndex
CREATE INDEX "ReservationChangeNotice_reservationId_responseStatus_idx" ON "ReservationChangeNotice"("reservationId", "responseStatus");

-- CreateIndex
CREATE INDEX "ReservationChangeNotice_responseStatus_createdAt_idx" ON "ReservationChangeNotice"("responseStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationChangeNotice_changeAuditId_reservationId_key" ON "ReservationChangeNotice"("changeAuditId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_requestKey_key" ON "EmailDelivery"("requestKey");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_leaseExpiresAt_idx" ON "EmailDelivery"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_closedAt_idx" ON "EmailDelivery"("closedAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_tokenId_idx" ON "EmailDelivery"("tokenId");

-- CreateIndex
CREATE INDEX "EmailDelivery_confirmationAuditId_idx" ON "EmailDelivery"("confirmationAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_tokenReferenceId_kind_key" ON "EmailDelivery"("tokenReferenceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_noticeId_kind_key" ON "EmailDelivery"("noticeId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryAttempt_deliveryId_attemptNumber_key" ON "EmailDeliveryAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_requestKey_key" ON "AuditLog"("requestKey");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorMemberId_createdAt_idx" ON "AuditLog"("actorMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorStaffId_createdAt_idx" ON "AuditLog"("actorStaffId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorAdminId_createdAt_idx" ON "AuditLog"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_lastAttemptAt_idx" ON "RateLimitBucket"("lastAttemptAt");

-- CreateIndex
CREATE INDEX "RateLimitEvent_scope_keyDigest_occurredAt_idx" ON "RateLimitEvent"("scope", "keyDigest", "occurredAt");

-- CreateIndex
CREATE INDEX "Member_lastNameKey_firstNameKey_isDeleted_idx" ON "Member"("lastNameKey", "firstNameKey", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_cancellationAuditId_key" ON "Reservation"("cancellationAuditId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_cancellationAuditId_fkey" FOREIGN KEY ("cancellationAuditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberLifecycleEvent" ADD CONSTRAINT "MemberLifecycleEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberLifecycleEvent" ADD CONSTRAINT "MemberLifecycleEvent_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberReview" ADD CONSTRAINT "MemberReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberReview" ADD CONSTRAINT "MemberReview_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberReview" ADD CONSTRAINT "MemberReview_decisionAuditId_fkey" FOREIGN KEY ("decisionAuditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberReviewMatch" ADD CONSTRAINT "MemberReviewMatch_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MemberReview"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberReviewMatch" ADD CONSTRAINT "MemberReviewMatch_matchedMemberId_fkey" FOREIGN KEY ("matchedMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BusinessDay" ADD CONSTRAINT "BusinessDay_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BusinessSchedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TherapistSchedule" ADD CONSTRAINT "TherapistSchedule_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TherapistBreak" ADD CONSTRAINT "TherapistBreak_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TherapistSchedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationChangeNotice" ADD CONSTRAINT "ReservationChangeNotice_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationChangeNotice" ADD CONSTRAINT "ReservationChangeNotice_changeAuditId_fkey" FOREIGN KEY ("changeAuditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AuthToken"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "ReservationChangeNotice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_confirmationAuditId_fkey" FOREIGN KEY ("confirmationAuditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "EmailDelivery"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RateLimitEvent" ADD CONSTRAINT "RateLimitEvent_scope_keyDigest_fkey" FOREIGN KEY ("scope", "keyDigest") REFERENCES "RateLimitBucket"("scope", "keyDigest") ON DELETE CASCADE ON UPDATE RESTRICT;

-- SQL-only checks and partial uniqueness.
ALTER TABLE "Member" ADD CONSTRAINT "Member_operationalVersion_check" CHECK ("version" >= 1 AND "restoreGeneration" >= 0);
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_check" CHECK (("actorType"='MEMBER' AND "actorMemberId" IS NOT NULL AND "actorStaffId" IS NULL AND "actorAdminId" IS NULL) OR ("actorType"='STAFF' AND "actorMemberId" IS NULL AND "actorStaffId" IS NOT NULL AND "actorAdminId" IS NULL) OR ("actorType"='ADMIN' AND "actorMemberId" IS NULL AND "actorStaffId" IS NULL AND "actorAdminId" IS NOT NULL) OR ("actorType"='SYSTEM' AND "actorMemberId" IS NULL AND "actorStaffId" IS NULL AND "actorAdminId" IS NULL));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_content_check" CHECK (btrim("action") <> '' AND btrim("targetType") <> '' AND ("changes" IS NULL OR jsonb_typeof("changes")='object'));
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_identity_check" CHECK ("digest" ~ '^[0-9a-f]{64}$' AND "authVersion">=1 AND "emailKey"=lower("emailKey") AND "emailKey" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' );
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_owner_check" CHECK (("memberId" IS NOT NULL AND "staffId" IS NULL) OR ("memberId" IS NULL AND "staffId" IS NOT NULL AND "purpose"='PASSWORD_RESET'));
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_generation_check" CHECK (("purpose"='RESTORE_CONFIRM' AND "restoreGeneration" IS NOT NULL AND "restoreGeneration">0) OR ("purpose"<>'RESTORE_CONFIRM' AND "restoreGeneration" IS NULL));
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_times_check" CHECK (isfinite("createdAt") AND isfinite("expiresAt") AND "expiresAt">"createdAt" AND "expiresAt" <= "createdAt" + CASE WHEN "purpose"='PASSWORD_RESET' THEN INTERVAL '1 hour' ELSE INTERVAL '24 hours' END AND ("usedAt" IS NULL OR (isfinite("usedAt") AND "usedAt">="createdAt" AND "usedAt"<"expiresAt")) AND ("revokedAt" IS NULL OR (isfinite("revokedAt") AND "revokedAt">="createdAt")) AND ("usedAt" IS NULL OR "revokedAt" IS NULL));
ALTER TABLE "MemberLifecycleEvent" ADD CONSTRAINT "MemberLifecycleEvent_details_check" CHECK ("restoreGeneration">=0 AND ("kind" NOT IN ('RESTORE_REQUESTED','RESTORE_COMPLETED','RESTORE_CANCELLED') OR "restoreGeneration">0) AND ("reason" IS NULL OR btrim("reason")<>'') AND ("kind" NOT IN ('VOLUNTARY_WITHDRAWAL','RESTORE_CANCELLED') OR ("reason" IS NOT NULL AND btrim("reason")<>'')));
ALTER TABLE "MemberReview" ADD CONSTRAINT "MemberReview_decision_check" CHECK ("version">=1 AND (("decision"='PENDING' AND "reason" IS NULL AND "reviewedByAdminId" IS NULL AND "reviewedAt" IS NULL AND "decisionAuditId" IS NULL) OR ("decision"<>'PENDING' AND "reason" IS NOT NULL AND btrim("reason")<>'' AND "reviewedByAdminId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND isfinite("reviewedAt") AND "reviewedAt">="createdAt" AND "decisionAuditId" IS NOT NULL)));
ALTER TABLE "BusinessDay" ADD CONSTRAINT "BusinessDay_hours_check" CHECK ("weekday" BETWEEN 0 AND 6 AND EXTRACT(MINUTE FROM "closesAt")=0 AND EXTRACT(SECOND FROM "closesAt")=0 AND ((NOT "isOpen" AND "opensAt" IS NULL) OR ("isOpen" AND "opensAt" IS NOT NULL AND EXTRACT(MINUTE FROM "opensAt")=0 AND EXTRACT(SECOND FROM "opensAt")=0 AND "opensAt"<"closesAt")));
ALTER TABLE "TherapistBreak" ADD CONSTRAINT "TherapistBreak_hours_check" CHECK ("weekday" BETWEEN 0 AND 6 AND (("startsAt" IS NULL AND "endsAt" IS NULL) OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND EXTRACT(MINUTE FROM "startsAt")=0 AND EXTRACT(SECOND FROM "startsAt")=0 AND "endsAt"-"startsAt"=INTERVAL '1 hour')));
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_execution_check" CHECK (("actualStartedAt" IS NULL OR isfinite("actualStartedAt")) AND ("actualCompletedAt" IS NULL OR isfinite("actualCompletedAt")) AND ("cancelledAt" IS NULL OR isfinite("cancelledAt")) AND (("status"='CONFIRMED' AND "actualStartedAt" IS NULL AND "actualCompletedAt" IS NULL AND "cancelledAt" IS NULL AND "cancellationKind" IS NULL AND "cancellationAuditId" IS NULL AND "cancellationReason" IS NULL) OR ("status"='IN_PROGRESS' AND "actualStartedAt" IS NOT NULL AND "actualCompletedAt" IS NULL AND "cancelledAt" IS NULL AND "cancellationKind" IS NULL AND "cancellationAuditId" IS NULL AND "cancellationReason" IS NULL) OR ("status"='COMPLETED' AND "actualStartedAt" IS NOT NULL AND "actualCompletedAt" IS NOT NULL AND "actualCompletedAt">="actualStartedAt" AND "cancelledAt" IS NULL AND "cancellationKind" IS NULL AND "cancellationAuditId" IS NULL AND "cancellationReason" IS NULL) OR ("status"='CANCELLED' AND "actualStartedAt" IS NULL AND "actualCompletedAt" IS NULL AND "cancelledAt" IS NOT NULL AND "cancellationKind" IS NOT NULL AND "cancellationAuditId" IS NOT NULL AND ("cancellationReason" IS NULL OR btrim("cancellationReason")<>'') AND ("cancellationKind"<>'STORE_EXCEPTION' OR ("cancellationReason" IS NOT NULL AND btrim("cancellationReason")<>'')))));
ALTER TABLE "ReservationChangeNotice" ADD CONSTRAINT "ReservationChangeNotice_state_check" CHECK ("version">=1 AND "reservationVersion">=1 AND btrim("reason")<>'' AND ("proposedChange" IS NULL OR jsonb_typeof("proposedChange")='object') AND (("responseStatus"='RESOLVED' AND "resolvedAt" IS NOT NULL AND isfinite("resolvedAt") AND "resolvedAt">="createdAt") OR ("responseStatus"<>'RESOLVED' AND "resolvedAt" IS NULL)));
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_target_check" CHECK (("kind"='RESERVATION_CHANGE' AND "noticeId" IS NOT NULL AND "confirmationAuditId" IS NOT NULL AND "tokenId" IS NULL AND "tokenReferenceId" IS NULL) OR ("kind"<>'RESERVATION_CHANGE' AND "noticeId" IS NULL AND "confirmationAuditId" IS NULL AND "tokenReferenceId" IS NOT NULL AND ("tokenId" IS NULL OR "tokenId"="tokenReferenceId")));
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_payload_check" CHECK ((("encryptedPayload" IS NULL AND "payloadKeyId" IS NULL AND "payloadExpiresAt" IS NULL) OR ("encryptedPayload" IS NOT NULL AND octet_length("encryptedPayload")>0 AND "payloadKeyId" IS NOT NULL AND btrim("payloadKeyId")<>'' AND "payloadExpiresAt" IS NOT NULL AND isfinite("payloadExpiresAt") AND "payloadExpiresAt">"createdAt")) AND ("recipient" IS NULL OR "recipient" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AND ("status" NOT IN ('PENDING','SENDING','RETRY_WAIT') OR ("recipient" IS NOT NULL AND ("kind"='RESERVATION_CHANGE' OR ("tokenId" IS NOT NULL AND "encryptedPayload" IS NOT NULL)))) AND ("status" IN ('PENDING','SENDING','RETRY_WAIT') OR "encryptedPayload" IS NULL));
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_queue_check" CHECK ("version">=1 AND "attemptCount" BETWEEN 0 AND 4 AND (("status"='SENDING' AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND isfinite("leaseExpiresAt") AND "leaseExpiresAt">"createdAt" AND "attemptCount">=1) OR ("status"<>'SENDING' AND "leaseId" IS NULL AND "leaseExpiresAt" IS NULL)) AND ("status"<>'RETRY_WAIT' OR ("nextAttemptAt" IS NOT NULL AND "attemptCount" BETWEEN 1 AND 3)) AND ("nextAttemptAt" IS NULL OR (isfinite("nextAttemptAt") AND "nextAttemptAt">="createdAt" AND "status" IN ('PENDING','RETRY_WAIT'))));
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_outcome_check" CHECK (("closedAt" IS NULL OR (isfinite("closedAt") AND "closedAt">="createdAt" AND "status" NOT IN ('PENDING','SENDING','RETRY_WAIT'))) AND (("status"='ACCEPTED' AND "acceptedAt" IS NOT NULL AND isfinite("acceptedAt") AND "acceptedAt">="createdAt" AND "closedAt" IS NOT NULL AND "closedAt">="acceptedAt" AND "attemptCount">=1) OR ("status"<>'ACCEPTED' AND "acceptedAt" IS NULL)));
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_state_check" CHECK ("attemptNumber" BETWEEN 1 AND 4 AND isfinite("startedAt") AND (("result"='STARTED' AND "finishedAt" IS NULL) OR ("result"<>'STARTED' AND "finishedAt" IS NOT NULL AND isfinite("finishedAt") AND "finishedAt">="startedAt")) AND ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z0-9_]{1,100}$'));
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_key_check" CHECK ("keyDigest" ~ '^[0-9a-f]{64}$' AND isfinite("lastAttemptAt"));
ALTER TABLE "RateLimitEvent" ADD CONSTRAINT "RateLimitEvent_time_check" CHECK (isfinite("occurredAt"));
CREATE UNIQUE INDEX "MemberReview_one_pending_key" ON "MemberReview" ("memberId") WHERE "decision"='PENDING';

-- Business audit history is append-only, including when raw SQL is used.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
COMMIT;
