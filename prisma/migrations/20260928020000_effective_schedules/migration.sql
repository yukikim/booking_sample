BEGIN;

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('BUSINESS_WEEKLY', 'BUSINESS_DATE', 'THERAPIST_BREAK');

-- CreateEnum
CREATE TYPE "ScheduleChangeAction" AS ENUM ('CREATE', 'REVISE', 'CANCEL');

-- CreateTable
CREATE TABLE "SchedulePlan" (
    "id" UUID NOT NULL,
    "kind" "ScheduleKind" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "therapistId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSettingChange" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "ScheduleChangeAction" NOT NULL,
    "previousId" UUID,
    "businessScheduleId" UUID,
    "therapistScheduleId" UUID,
    "businessOverrideId" UUID,
    "auditId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleSettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDateOverride" (
    "id" UUID NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "opensAt" TIME(0),
    "closesAt" TIME(0) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessDateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettingState" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StoreSettingState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchedulePlan_kind_effectiveDate_idx" ON "SchedulePlan"("kind", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePlan_therapistId_effectiveDate_key" ON "SchedulePlan"("therapistId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettingChange_previousId_key" ON "ScheduleSettingChange"("previousId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettingChange_auditId_key" ON "ScheduleSettingChange"("auditId");

-- CreateIndex
CREATE INDEX "ScheduleSettingChange_businessScheduleId_idx" ON "ScheduleSettingChange"("businessScheduleId");

-- CreateIndex
CREATE INDEX "ScheduleSettingChange_therapistScheduleId_idx" ON "ScheduleSettingChange"("therapistScheduleId");

-- CreateIndex
CREATE INDEX "ScheduleSettingChange_businessOverrideId_idx" ON "ScheduleSettingChange"("businessOverrideId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettingChange_id_planId_key" ON "ScheduleSettingChange"("id", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettingChange_previousId_planId_key" ON "ScheduleSettingChange"("previousId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettingChange_planId_revision_key" ON "ScheduleSettingChange"("planId", "revision");

-- AddForeignKey
ALTER TABLE "SchedulePlan" ADD CONSTRAINT "SchedulePlan_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_previousId_planId_fkey" FOREIGN KEY ("previousId", "planId") REFERENCES "ScheduleSettingChange"("id", "planId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_businessScheduleId_fkey" FOREIGN KEY ("businessScheduleId") REFERENCES "BusinessSchedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_therapistScheduleId_fkey" FOREIGN KEY ("therapistScheduleId") REFERENCES "TherapistSchedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_businessOverrideId_fkey" FOREIGN KEY ("businessOverrideId") REFERENCES "BusinessDateOverride"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The adopted specification limits all business/break closing times to 23:00.
ALTER TABLE "BusinessDay" ADD CONSTRAINT "BusinessDay_closingLimit_check" CHECK ("closesAt" <= TIME '23:00');
ALTER TABLE "TherapistBreak" ADD CONSTRAINT "TherapistBreak_closingLimit_check" CHECK ("endsAt" IS NULL OR "endsAt" <= TIME '23:00');
ALTER TABLE "SchedulePlan" ADD CONSTRAINT "SchedulePlan_scope_check" CHECK (
  isfinite("effectiveDate") AND
  (("kind"='THERAPIST_BREAK' AND "therapistId" IS NOT NULL) OR ("kind"<>'THERAPIST_BREAK' AND "therapistId" IS NULL))
);
CREATE UNIQUE INDEX "SchedulePlan_business_date_key" ON "SchedulePlan" ("kind","effectiveDate") WHERE "therapistId" IS NULL;
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_revision_check" CHECK (
  ("revision"=1 AND "action"='CREATE' AND "previousId" IS NULL) OR
  ("revision">1 AND "action" IN ('REVISE','CANCEL') AND "previousId" IS NOT NULL)
);
ALTER TABLE "ScheduleSettingChange" ADD CONSTRAINT "ScheduleSettingChange_content_check" CHECK (
  btrim("reason")<>'' AND isfinite("createdAt") AND
  (("action"='CANCEL' AND num_nonnulls("businessScheduleId","therapistScheduleId","businessOverrideId")=0) OR
   ("action"<>'CANCEL' AND num_nonnulls("businessScheduleId","therapistScheduleId","businessOverrideId")=1))
);
ALTER TABLE "BusinessDateOverride" ADD CONSTRAINT "BusinessDateOverride_hours_check" CHECK (
  "closesAt"<=TIME '23:00' AND EXTRACT(MINUTE FROM "closesAt")=0 AND EXTRACT(SECOND FROM "closesAt")=0 AND
  ((NOT "isOpen" AND "opensAt" IS NULL) OR
   ("isOpen" AND "opensAt" IS NOT NULL AND EXTRACT(MINUTE FROM "opensAt")=0 AND EXTRACT(SECOND FROM "opensAt")=0 AND "opensAt"<"closesAt"))
);
ALTER TABLE "StoreSettingState" ADD CONSTRAINT "StoreSettingState_singleton_check" CHECK ("id"=1 AND "version">=1);

-- History is append-only. A previous revision can have only one successor.
CREATE FUNCTION reject_setting_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Setting history is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER schedule_plan_immutable BEFORE UPDATE OR DELETE ON "SchedulePlan"
FOR EACH ROW EXECUTE FUNCTION reject_setting_history_mutation();
CREATE TRIGGER schedule_change_immutable BEFORE UPDATE OR DELETE ON "ScheduleSettingChange"
FOR EACH ROW EXECUTE FUNCTION reject_setting_history_mutation();

-- Serialize snapshot publication with edits to its content.
CREATE FUNCTION validate_setting_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  plan_kind text;
  plan_therapist uuid;
  prior_revision integer;
  prior_action text;
  prior_time timestamptz;
  content_therapist uuid;
  row_count integer;
BEGIN
  EXECUTE format('SELECT "kind","therapistId" FROM %I."SchedulePlan" WHERE id=$1',TG_TABLE_SCHEMA)
    INTO plan_kind,plan_therapist USING NEW."planId";
  IF plan_kind IS NULL THEN RETURN NEW; END IF; -- The FK reports missing plans.
  IF NEW."previousId" IS NOT NULL THEN
    EXECUTE format('SELECT revision,action,"createdAt" FROM %I."ScheduleSettingChange" WHERE id=$1 AND "planId"=$2',TG_TABLE_SCHEMA)
      INTO prior_revision,prior_action,prior_time USING NEW."previousId",NEW."planId";
    IF prior_revision IS NULL OR prior_revision+1<>NEW.revision OR prior_action='CANCEL' OR NEW."createdAt"<prior_time THEN
      RAISE EXCEPTION 'Invalid setting revision chain' USING ERRCODE='23514', CONSTRAINT='ScheduleSettingChange_chain_guard';
    END IF;
  END IF;
  IF NEW.action='CANCEL' THEN RETURN NEW; END IF;
  IF plan_kind='BUSINESS_WEEKLY' AND NEW."businessScheduleId" IS NOT NULL THEN
    EXECUTE format('SELECT id FROM %I."BusinessSchedule" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) USING NEW."businessScheduleId";
    EXECUTE format('SELECT count(*) FROM %I."BusinessDay" WHERE "scheduleId"=$1',TG_TABLE_SCHEMA) INTO row_count USING NEW."businessScheduleId";
    IF row_count=7 THEN RETURN NEW; END IF;
  ELSIF plan_kind='THERAPIST_BREAK' AND NEW."therapistScheduleId" IS NOT NULL THEN
    EXECUTE format('SELECT "therapistId" FROM %I."TherapistSchedule" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO content_therapist USING NEW."therapistScheduleId";
    EXECUTE format('SELECT count(*) FROM %I."TherapistBreak" WHERE "scheduleId"=$1',TG_TABLE_SCHEMA) INTO row_count USING NEW."therapistScheduleId";
    IF row_count=7 AND content_therapist=plan_therapist THEN RETURN NEW; END IF;
  ELSIF plan_kind='BUSINESS_DATE' AND NEW."businessOverrideId" IS NOT NULL THEN
    EXECUTE format('SELECT id FROM %I."BusinessDateOverride" WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA) INTO content_therapist USING NEW."businessOverrideId";
    IF content_therapist IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Setting content must match scope and contain all weekdays' USING ERRCODE='23514', CONSTRAINT='ScheduleSettingChange_snapshot_guard';
END;
$$;
CREATE TRIGGER validate_schedule_change BEFORE INSERT ON "ScheduleSettingChange"
FOR EACH ROW EXECUTE FUNCTION validate_setting_change();

CREATE FUNCTION protect_schedule_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_table text;
  reference_column text;
  ids uuid[];
  content_id uuid;
  published boolean;
BEGIN
  IF TG_TABLE_NAME IN ('BusinessSchedule','BusinessDay') THEN
    parent_table:='BusinessSchedule'; reference_column:='businessScheduleId';
  ELSIF TG_TABLE_NAME IN ('TherapistSchedule','TherapistBreak') THEN
    parent_table:='TherapistSchedule'; reference_column:='therapistScheduleId';
  ELSE
    parent_table:='BusinessDateOverride'; reference_column:='businessOverrideId';
  END IF;
  IF TG_TABLE_NAME IN ('BusinessDay','TherapistBreak') THEN
    IF TG_OP='INSERT' THEN ids:=ARRAY[NEW."scheduleId"];
    ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD."scheduleId"];
    ELSE ids:=ARRAY[OLD."scheduleId",NEW."scheduleId"]; END IF;
  ELSE
    IF TG_OP='INSERT' THEN RETURN NEW; END IF;
    ids:=ARRAY[OLD.id];
  END IF;
  FOR content_id IN SELECT DISTINCT x FROM unnest(ids) AS x ORDER BY x LOOP
    EXECUTE format('SELECT id FROM %I.%I WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA,parent_table) USING content_id;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."ScheduleSettingChange" WHERE %I=$1)',TG_TABLE_SCHEMA,reference_column) INTO published USING content_id;
    IF published THEN RAISE EXCEPTION 'Published setting content is immutable' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_schedule_content BEFORE INSERT OR UPDATE OR DELETE ON "BusinessSchedule" FOR EACH ROW EXECUTE FUNCTION protect_schedule_content();
CREATE TRIGGER protect_schedule_content BEFORE INSERT OR UPDATE OR DELETE ON "BusinessDay" FOR EACH ROW EXECUTE FUNCTION protect_schedule_content();
CREATE TRIGGER protect_schedule_content BEFORE INSERT OR UPDATE OR DELETE ON "TherapistSchedule" FOR EACH ROW EXECUTE FUNCTION protect_schedule_content();
CREATE TRIGGER protect_schedule_content BEFORE INSERT OR UPDATE OR DELETE ON "TherapistBreak" FOR EACH ROW EXECUTE FUNCTION protect_schedule_content();
CREATE TRIGGER protect_schedule_content BEFORE INSERT OR UPDATE OR DELETE ON "BusinessDateOverride" FOR EACH ROW EXECUTE FUNCTION protect_schedule_content();

COMMIT;
