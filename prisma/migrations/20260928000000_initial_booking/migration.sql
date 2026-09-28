-- Initial booking foundation. CHECK constraints are maintained in SQL.
BEGIN;

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING_EMAIL', 'PENDING_REVIEW', 'REJECTED', 'ACTIVE', 'WITHDRAWN', 'RESTORE_PENDING');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('MEMBER', 'STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "emailKey" VARCHAR(254) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastNameKey" TEXT NOT NULL,
    "firstNameKey" TEXT NOT NULL,
    "phoneNumber" VARCHAR(11) NOT NULL,
    "postalCode" VARCHAR(7) NOT NULL,
    "ageBand" SMALLINT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "firstActivatedAt" TIMESTAMPTZ(3),
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAccount" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "emailKey" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccount" (
    "id" UUID NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" UUID NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "memberId" UUID,
    "staffId" UUID,
    "adminId" UUID,
    "authVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Therapist" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Therapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Treatment" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceYen" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Treatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceYen" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "treatmentId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "memberLastNameSnapshot" VARCHAR(100) NOT NULL,
    "memberFirstNameSnapshot" VARCHAR(100) NOT NULL,
    "memberEmailSnapshot" VARCHAR(254) NOT NULL,
    "memberPhoneNumberSnapshot" VARCHAR(11) NOT NULL,
    "treatmentNameSnapshot" VARCHAR(100) NOT NULL,
    "treatmentDurationMinutesSnapshot" INTEGER NOT NULL,
    "treatmentPriceYenSnapshot" INTEGER NOT NULL,
    "roomNameSnapshot" VARCHAR(100) NOT NULL,
    "therapistNameSnapshot" VARCHAR(100) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "businessDate" DATE NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "treatmentEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "occupiesUntil" TIMESTAMPTZ(3) NOT NULL,
    "totalDurationMinutes" INTEGER NOT NULL,
    "totalPriceYen" INTEGER NOT NULL,
    "slotCount" INTEGER NOT NULL,
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationOption" (
    "reservationId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "optionNameSnapshot" VARCHAR(100) NOT NULL,
    "optionDurationMinutesSnapshot" INTEGER NOT NULL,
    "optionPriceYenSnapshot" INTEGER NOT NULL,

    CONSTRAINT "ReservationOption_pkey" PRIMARY KEY ("reservationId","optionId")
);

-- CreateTable
CREATE TABLE "ReservationSlot" (
    "reservationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "slotStartsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservationSlot_pkey" PRIMARY KEY ("reservationId","slotStartsAt")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_emailKey_key" ON "Member"("emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccount_emailKey_key" ON "StaffAccount"("emailKey");

-- CreateIndex
CREATE INDEX "Reservation_businessDate_startsAt_idx" ON "Reservation"("businessDate", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_memberId_startsAt_idx" ON "Reservation"("memberId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_roomId_startsAt_idx" ON "Reservation"("roomId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_therapistId_startsAt_idx" ON "Reservation"("therapistId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_treatmentId_idx" ON "Reservation"("treatmentId");

-- CreateIndex
CREATE INDEX "Reservation_status_startsAt_idx" ON "Reservation"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_id_roomId_therapistId_key" ON "Reservation"("id", "roomId", "therapistId");

-- CreateIndex
CREATE INDEX "ReservationOption_optionId_idx" ON "ReservationOption"("optionId");

-- CreateIndex
CREATE INDEX "ReservationSlot_slotStartsAt_idx" ON "ReservationSlot"("slotStartsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSlot_roomId_slotStartsAt_key" ON "ReservationSlot"("roomId", "slotStartsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSlot_therapistId_slotStartsAt_key" ON "ReservationSlot"("therapistId", "slotStartsAt");

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationSlot" ADD CONSTRAINT "ReservationSlot_reservationId_roomId_therapistId_fkey" FOREIGN KEY ("reservationId", "roomId", "therapistId") REFERENCES "Reservation"("id", "roomId", "therapistId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Row-level business constraints (not expressible in Prisma Schema).
ALTER TABLE "Member" ADD CONSTRAINT "Member_lastName_check" CHECK (btrim("lastName") <> '' AND "lastName" !~ '[[:cntrl:]]');
ALTER TABLE "Member" ADD CONSTRAINT "Member_firstName_check" CHECK (btrim("firstName") <> '' AND "firstName" !~ '[[:cntrl:]]');
ALTER TABLE "Member" ADD CONSTRAINT "Member_lastNameKey_check" CHECK (btrim("lastNameKey") <> '' AND "lastNameKey" !~ '[[:cntrl:]]');
ALTER TABLE "Member" ADD CONSTRAINT "Member_firstNameKey_check" CHECK (btrim("firstNameKey") <> '' AND "firstNameKey" !~ '[[:cntrl:]]');
ALTER TABLE "Member" ADD CONSTRAINT "Member_passwordHash_check" CHECK (btrim("passwordHash") <> '' AND "passwordHash" !~ '[[:cntrl:]]');
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_displayName_check" CHECK (btrim("displayName") <> '' AND "displayName" !~ '[[:cntrl:]]');
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_passwordHash_check" CHECK (btrim("passwordHash") <> '' AND "passwordHash" !~ '[[:cntrl:]]');
ALTER TABLE "AdminAccount" ADD CONSTRAINT "AdminAccount_displayName_check" CHECK (btrim("displayName") <> '' AND "displayName" !~ '[[:cntrl:]]');
ALTER TABLE "Room" ADD CONSTRAINT "Room_name_check" CHECK (btrim("name") <> '' AND "name" !~ '[[:cntrl:]]');
ALTER TABLE "Therapist" ADD CONSTRAINT "Therapist_name_check" CHECK (btrim("name") <> '' AND "name" !~ '[[:cntrl:]]');
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_name_check" CHECK (btrim("name") <> '' AND "name" !~ '[[:cntrl:]]');
ALTER TABLE "Option" ADD CONSTRAINT "Option_name_check" CHECK (btrim("name") <> '' AND "name" !~ '[[:cntrl:]]');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberLastNameSnapshot_check" CHECK (btrim("memberLastNameSnapshot") <> '' AND "memberLastNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberFirstNameSnapshot_check" CHECK (btrim("memberFirstNameSnapshot") <> '' AND "memberFirstNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_treatmentNameSnapshot_check" CHECK (btrim("treatmentNameSnapshot") <> '' AND "treatmentNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_roomNameSnapshot_check" CHECK (btrim("roomNameSnapshot") <> '' AND "roomNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_therapistNameSnapshot_check" CHECK (btrim("therapistNameSnapshot") <> '' AND "therapistNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_optionNameSnapshot_check" CHECK (btrim("optionNameSnapshot") <> '' AND "optionNameSnapshot" !~ '[[:cntrl:]]');
ALTER TABLE "Member" ADD CONSTRAINT "Member_email_check" CHECK ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
ALTER TABLE "Member" ADD CONSTRAINT "Member_emailKey_check" CHECK ("emailKey" = lower("email"));
ALTER TABLE "Member" ADD CONSTRAINT "Member_authVersion_check" CHECK ("authVersion" >= 1);
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_email_check" CHECK ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_emailKey_check" CHECK ("emailKey" = lower("email"));
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_authVersion_check" CHECK ("authVersion" >= 1);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberEmailSnapshot_check" CHECK ("memberEmailSnapshot" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
ALTER TABLE "Member" ADD CONSTRAINT "Member_phoneNumber_check" CHECK ("phoneNumber" ~ '^[0-9]{10,11}$');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberPhoneNumberSnapshot_check" CHECK ("memberPhoneNumberSnapshot" ~ '^[0-9]{10,11}$');
ALTER TABLE "Member" ADD CONSTRAINT "Member_postalCode_check" CHECK ("postalCode" ~ '^[0-9]{7}$');
ALTER TABLE "Member" ADD CONSTRAINT "Member_ageBand_check" CHECK ("ageBand" IN (20,30,40,50,60,70,80));
ALTER TABLE "Member" ADD CONSTRAINT "Member_state_check" CHECK ("isDeleted" = ("status" IN ('WITHDRAWN','RESTORE_PENDING')) AND ("status" <> 'ACTIVE' OR ("emailVerifiedAt" IS NOT NULL AND "firstActivatedAt" IS NOT NULL)));
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_owner_check" CHECK (("principalType" = 'MEMBER' AND "memberId" IS NOT NULL AND "staffId" IS NULL AND "adminId" IS NULL) OR ("principalType" = 'STAFF' AND "memberId" IS NULL AND "staffId" IS NOT NULL AND "adminId" IS NULL) OR ("principalType" = 'ADMIN' AND "memberId" IS NULL AND "staffId" IS NULL AND "adminId" IS NOT NULL));
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_authVersion_check" CHECK ("authVersion" >= 1);
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_times_check" CHECK (isfinite("createdAt") AND isfinite("expiresAt") AND "expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR (isfinite("revokedAt") AND "revokedAt" >= "createdAt")));
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_durationMinutes_check" CHECK ("durationMinutes" BETWEEN 1 AND 1380);
ALTER TABLE "Option" ADD CONSTRAINT "Option_durationMinutes_check" CHECK ("durationMinutes" BETWEEN 0 AND 1380);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_treatmentDurationMinutesSnapshot_check" CHECK ("treatmentDurationMinutesSnapshot" BETWEEN 1 AND 1380);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_durationBounds_check" CHECK ("totalDurationMinutes" BETWEEN 1 AND 1380);
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_optionDurationMinutesSnapshot_check" CHECK ("optionDurationMinutesSnapshot" BETWEEN 0 AND 1380);
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_priceYen_check" CHECK ("priceYen" BETWEEN 0 AND 1000000);
ALTER TABLE "Option" ADD CONSTRAINT "Option_priceYen_check" CHECK ("priceYen" BETWEEN 0 AND 1000000);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_treatmentPriceYenSnapshot_check" CHECK ("treatmentPriceYenSnapshot" BETWEEN 0 AND 1000000);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_totalPriceYen_check" CHECK ("totalPriceYen" BETWEEN 0 AND 1000000);
ALTER TABLE "ReservationOption" ADD CONSTRAINT "ReservationOption_optionPriceYenSnapshot_check" CHECK ("optionPriceYenSnapshot" BETWEEN 0 AND 1000000);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_version_check" CHECK ("version" >= 1);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_slotCount_check" CHECK ("slotCount" BETWEEN 1 AND 23 AND "slotCount" = ("totalDurationMinutes" + 59) / 60);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_times_check" CHECK (isfinite("startsAt") AND isfinite("treatmentEndsAt") AND isfinite("occupiesUntil") AND "treatmentEndsAt" = "startsAt" + "totalDurationMinutes" * INTERVAL '1 minute' AND "occupiesUntil" = "startsAt" + "slotCount" * INTERVAL '1 hour');
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_businessDate_check" CHECK (isfinite("businessDate") AND "businessDate" = ("startsAt" AT TIME ZONE 'Asia/Tokyo')::date AND ("occupiesUntil" AT TIME ZONE 'Asia/Tokyo') <= ("businessDate" + 1)::timestamp);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_startsAt_check" CHECK (isfinite("startsAt") AND "startsAt" AT TIME ZONE 'Asia/Tokyo' = date_trunc('hour', "startsAt" AT TIME ZONE 'Asia/Tokyo'));
ALTER TABLE "ReservationSlot" ADD CONSTRAINT "ReservationSlot_slotStartsAt_check" CHECK (isfinite("slotStartsAt") AND "slotStartsAt" AT TIME ZONE 'Asia/Tokyo' = date_trunc('hour', "slotStartsAt" AT TIME ZONE 'Asia/Tokyo'));

COMMIT;
