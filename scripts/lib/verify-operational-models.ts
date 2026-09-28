import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client, DatabaseError } from "pg";
import { seedIds } from "../../prisma/seed-data";

/** Fixtures only: no token generation, encryption, login, or SMTP is performed. */
export async function verifyOperationalModels(db: Client, checked: Set<string>): Promise<number> {
  let passed = 0;
  const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
  async function insert(table: string, data: Record<string, unknown>) {
    const keys = Object.keys(data);
    return db.query(`INSERT INTO ${q(table)} (${keys.map(q).join(",")}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(",")})`,Object.values(data));
  }
  async function reject(action:()=>Promise<unknown>,code:string,constraint?:string) {
    await db.query("SAVEPOINT operational_case");
    try {
      await assert.rejects(action,(error:unknown)=>{
        const e=error as DatabaseError;
        assert.equal(e.code,code);
        if(constraint) {assert.equal(e.constraint,constraint);checked.add(constraint);}
        return true;
      });
      passed++;
    } finally { await db.query("ROLLBACK TO SAVEPOINT operational_case"); await db.query("RELEASE SAVEPOINT operational_case"); }
  }
  const now = new Date("2026-10-02T00:00:00Z");
  const later = new Date(now.getTime()+3600000);
  const memberId=(await db.query('SELECT id FROM "Member" LIMIT 1')).rows[0].id as string;
  const staffId=(await db.query('SELECT id FROM "StaffAccount" LIMIT 1')).rows[0].id as string;
  const reservationId=(await db.query('SELECT id FROM "Reservation" WHERE status=\'CONFIRMED\' LIMIT 1')).rows[0].id as string;
  const audit={id:randomUUID(),requestKey:randomUUID(),actorType:"ADMIN",actorAdminId:seedIds.admin,action:"setting.change",targetType:"BusinessSchedule",targetId:randomUUID(),createdAt:now};
  const token={id:randomUUID(),digest:"a".repeat(64),purpose:"PASSWORD_RESET",memberId,emailKey:"fixture@example.test",authVersion:1,createdAt:now,expiresAt:later};
  const review={id:randomUUID(),memberId,createdAt:now};
  const event={id:randomUUID(),memberId,kind:"VOLUNTARY_WITHDRAWAL",reason:"利用終了",restoreGeneration:0,auditId:audit.id,createdAt:now};
  const business={id:randomUUID(),createdAt:now};
  const therapist={id:randomUUID(),therapistId:seedIds.therapists[0],createdAt:now};
  const day={scheduleId:business.id,weekday:1,isOpen:true,opensAt:"09:00:00",closesAt:"18:00:00"};
  const rest={scheduleId:therapist.id,weekday:1,startsAt:"12:00:00",endsAt:"13:00:00"};
  const notice={id:randomUUID(),reservationId,changeAuditId:audit.id,reservationVersion:1,reason:"営業時間変更",createdAt:now,updatedAt:now};
  const delivery={id:randomUUID(),requestKey:randomUUID(),kind:"PASSWORD_RESET",tokenId:token.id,tokenReferenceId:token.id,recipient:"fixture@example.test",encryptedPayload:Buffer.from("encrypted-fixture-not-real-token"),payloadKeyId:"fixture-key",payloadExpiresAt:later,createdAt:now,updatedAt:now};
  const attempt={id:randomUUID(),deliveryId:delivery.id,attemptNumber:1,leaseId:randomUUID(),startedAt:now};
  await db.query("BEGIN");
  try {
    for(const [table,row] of [
      ["AuditLog",audit],["AuthToken",token],["MemberLifecycleEvent",event],["MemberReview",review],
      ["BusinessSchedule",business],["TherapistSchedule",therapist],["BusinessDay",day],["TherapistBreak",rest],
      ["ReservationChangeNotice",notice],["EmailDelivery",delivery],["EmailDeliveryAttempt",attempt],
      ["RateLimitBucket",{scope:"MAIL_ADDRESS",keyDigest:"b".repeat(64),lastAttemptAt:now}],
      ["RateLimitEvent",{id:randomUUID(),scope:"MAIL_ADDRESS",keyDigest:"b".repeat(64),occurredAt:now}],
    ] as const) await insert(table,row);
    const fixtures: Record<string,{key:string,value:unknown}> = {
      Member:{key:"id",value:memberId},AuthToken:{key:"id",value:token.id},MemberLifecycleEvent:{key:"id",value:event.id},MemberReview:{key:"id",value:review.id},BusinessDay:{key:"scheduleId",value:business.id},TherapistBreak:{key:"scheduleId",value:therapist.id},Reservation:{key:"id",value:reservationId},ReservationChangeNotice:{key:"id",value:notice.id},EmailDelivery:{key:"id",value:delivery.id},EmailDeliveryAttempt:{key:"id",value:attempt.id},RateLimitBucket:{key:"keyDigest",value:"b".repeat(64)},RateLimitEvent:{key:"keyDigest",value:"b".repeat(64)},
    };
    async function invalid(table:string,name:string,changes:Record<string,unknown>) {
      const f=fixtures[table], entries=Object.entries(changes);
      await reject(()=>db.query(`UPDATE ${q(table)} SET ${entries.map(([k],i)=>`${q(k)}=$${i+1}`).join(",")} WHERE ${q(f.key)}=$${entries.length+1}`,[...entries.map(([,v])=>v),f.value]),"23514",`${table}_${name}_check`);
    }
    await invalid("Member","operationalVersion",{restoreGeneration:-1});
    await reject(()=>insert("AuditLog",{...audit,id:randomUUID(),requestKey:randomUUID(),actorAdminId:null}),"23514","AuditLog_actor_check");
    await reject(()=>insert("AuditLog",{...audit,id:randomUUID(),requestKey:randomUUID(),action:" "}),"23514","AuditLog_content_check");
    await invalid("AuthToken","identity",{digest:"plaintext-token"});
    await invalid("AuthToken","owner",{staffId});
    await invalid("AuthToken","generation",{purpose:"RESTORE_CONFIRM"});
    await invalid("AuthToken","times",{expiresAt:new Date(now.getTime()+7200000)});
    await invalid("AuthToken","times",{usedAt:later});
    await invalid("MemberLifecycleEvent","details",{reason:null});
    await invalid("MemberReview","decision",{decision:"DIFFERENT_PERSON"});
    await invalid("BusinessDay","hours",{weekday:7});
    await invalid("BusinessDay","hours",{opensAt:"09:30:00"});
    await invalid("BusinessDay","hours",{closesAt:"08:00:00"});
    await invalid("TherapistBreak","hours",{endsAt:"14:00:00"});
    await invalid("TherapistBreak","hours",{startsAt:null});
    await invalid("Reservation","execution",{status:"COMPLETED"});
    await invalid("ReservationChangeNotice","state",{responseStatus:"RESOLVED"});
    await invalid("EmailDelivery","target",{kind:"RESERVATION_CHANGE"});
    await invalid("EmailDelivery","payload",{payloadKeyId:null});
    await invalid("EmailDelivery","queue",{attemptCount:5});
    await invalid("EmailDelivery","queue",{status:"SENDING"});
    await invalid("EmailDelivery","outcome",{closedAt:later});
    await invalid("EmailDeliveryAttempt","state",{attemptNumber:5});
    await invalid("RateLimitBucket","key",{keyDigest:"plain@example.test"});
    await invalid("RateLimitEvent","time",{occurredAt:"infinity"});

    assert.equal((await db.query('SELECT count(*)::int AS n FROM "StaffPermission" WHERE "staffId"=$1',[staffId])).rows[0].n,0);
    const grant={staffId,permission:"RESERVATION_CANCEL",grantedByAdminId:seedIds.admin};
    await insert("StaffPermission",grant);
    await reject(()=>insert("StaffPermission",grant),"23505");
    await reject(()=>insert("StaffPermission",{...grant,permission:"PERMISSION_GRANT"}),"22P02");
    await reject(()=>insert("StaffPermission",{...grant,permission:"RESERVATION_UPDATE",grantedByAdminId:staffId}),"23503");
    await db.query('DELETE FROM "StaffPermission" WHERE "staffId"=$1',[staffId]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "StaffPermission" WHERE "staffId"=$1',[staffId])).rows[0].n,0);
    await reject(()=>insert("MemberReview",{...review,id:randomUUID()}),"23505","MemberReview_one_pending_key");
    await insert("MemberReviewMatch",{reviewId:review.id,matchedMemberId:memberId});
    await reject(()=>insert("MemberReviewMatch",{reviewId:review.id,matchedMemberId:randomUUID()}),"23503");
    await db.query('UPDATE "MemberReview" SET decision=\'DIFFERENT_PERSON\',reason=\'別人と確認\',"reviewedByAdminId"=$1,"reviewedAt"=$2,"decisionAuditId"=$3 WHERE id=$4',[seedIds.admin,now,audit.id,review.id]);
    await insert("MemberReview",{...review,id:randomUUID()});
    await insert("BusinessDay",{...day,weekday:0,isOpen:false,opensAt:null});
    await insert("TherapistBreak",{...rest,weekday:0,startsAt:null,endsAt:null});
    await reject(()=>insert("BusinessDay",day),"23505");
    await reject(()=>insert("TherapistBreak",rest),"23505");
    await reject(()=>db.query('UPDATE "AuditLog" SET action=\'changed\' WHERE id=$1',[audit.id]),"55000");
    await reject(()=>db.query('DELETE FROM "AuditLog" WHERE id=$1',[audit.id]),"55000");
    await reject(()=>insert("ReservationChangeNotice",{...notice,id:randomUUID()}),"23505");
    // Delivery and response states remain independent.
    const changeDelivery={id:randomUUID(),requestKey:randomUUID(),kind:"RESERVATION_CHANGE",noticeId:notice.id,confirmationAuditId:audit.id,recipient:"fixture@example.test",createdAt:now,updatedAt:now};
    await insert("EmailDelivery",changeDelivery);
    await reject(()=>insert("EmailDelivery",{...changeDelivery,id:randomUUID(),requestKey:randomUUID()}),"23505");
    await reject(()=>insert("EmailDelivery",{...changeDelivery,id:randomUUID(),requestKey:randomUUID(),confirmationAuditId:null}),"23514");
    // Conditional consumption and lease acquisition: a stale second request affects no rows.
    for(const expected of [1,0]) {
      const result=await db.query('UPDATE "AuthToken" SET "usedAt"=$2 WHERE id=$1 AND "usedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">$2',[token.id,now]);
      assert.equal(result.rowCount,expected);
    }
    const lease=randomUUID();
    for(const expected of [1,0]) {
      const result=await db.query('UPDATE "EmailDelivery" SET status=\'SENDING\',"leaseId"=$2,"leaseExpiresAt"=$3,"attemptCount"=1,version=2 WHERE id=$1 AND status=\'PENDING\' AND version=1',[changeDelivery.id,lease,later]);
      assert.equal(result.rowCount,expected);
    }
    await db.query('UPDATE "EmailDelivery" SET status=\'UNKNOWN\',"leaseId"=NULL,"leaseExpiresAt"=NULL WHERE id=$1',[changeDelivery.id]);
    await reject(()=>db.query('UPDATE "EmailDelivery" SET "nextAttemptAt"=$2 WHERE id=$1',[changeDelivery.id,later]),"23514");
    assert.equal((await db.query('SELECT "responseStatus" FROM "ReservationChangeNotice" WHERE id=$1',[notice.id])).rows[0].responseStatus,"UNCONTACTED");
    await reject(()=>insert("EmailDeliveryAttempt",{...attempt,id:randomUUID()}),"23505");
    // Retention: remove secret payload first, then expired token; receipt/dedup stays.
    await db.query('UPDATE "EmailDelivery" SET status=\'EXPIRED\',"encryptedPayload"=NULL,"payloadKeyId"=NULL,"payloadExpiresAt"=NULL WHERE id=$1',[delivery.id]);
    await db.query('DELETE FROM "AuthToken" WHERE id=$1',[token.id]);
    assert.deepEqual((await db.query('SELECT "tokenId","tokenReferenceId" FROM "EmailDelivery" WHERE id=$1',[delivery.id])).rows[0],{tokenId:null,tokenReferenceId:token.id});
    await reject(()=>insert("EmailDelivery",{...delivery,id:randomUUID(),requestKey:randomUUID(),status:"EXPIRED",tokenId:null,encryptedPayload:null,payloadKeyId:null,payloadExpiresAt:null}),"23505");
    const oldest=new Date(now.getTime()-3600000);
    await insert("RateLimitEvent",{id:randomUUID(),scope:"MAIL_ADDRESS",keyDigest:"b".repeat(64),occurredAt:oldest});
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "RateLimitEvent" WHERE scope=\'MAIL_ADDRESS\' AND "keyDigest"=$1 AND "occurredAt">$2 AND "occurredAt"<=$3',["b".repeat(64),oldest,now])).rows[0].n,1);
    await db.query('DELETE FROM "RateLimitBucket" WHERE scope=\'MAIL_ADDRESS\' AND "keyDigest"=$1',["b".repeat(64)]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "RateLimitEvent"')).rows[0].n,0);
    passed += 12;
  } finally { await db.query("ROLLBACK"); }
  return passed;
}
