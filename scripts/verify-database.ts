import { verifyEffectiveSchedules } from "./lib/verify-effective-schedules";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, type DatabaseError } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDevelopment, seedIds } from "../prisma/seed-data";
import { verifyOperationalModels } from "./lib/verify-operational-models";
import { loadDevelopmentDatabase, runPrisma } from "./lib/development-database";

let passed = 0;
const checked = new Set<string>();
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
async function insert(db: Client, table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  await db.query(`INSERT INTO ${quote(table)} (${keys.map(quote).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
}
async function rejected(db: Client, action: () => Promise<unknown>, code: string, constraint?: string) {
  await db.query("SAVEPOINT rejected_case");
  try {
    await assert.rejects(action, (error: unknown) => {
      const e = error as DatabaseError;
      assert.equal(e.code, code);
      if (constraint) { assert.equal(e.constraint, constraint); checked.add(constraint); }
      return true;
    });
    passed++;
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT rejected_case");
    await db.query("RELEASE SAVEPOINT rejected_case");
  }
}

async function verifyConstraints(db: Client, schema: string, connectionString: string) {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const memberId = randomUUID();
  const member = { id: memberId, email: "fixture@example.test", emailKey: "fixture@example.test", lastName: "予約", firstName: "確認", lastNameKey: "予約", firstNameKey: "確認", phoneNumber: "09000000000", postalCode: "0010000", ageBand: 30, passwordHash: "test-only-not-a-login-hash", status: "ACTIVE", isDeleted: false, emailVerifiedAt: now, firstActivatedAt: now, authVersion: 1, createdAt: now, updatedAt: now };
  await insert(db, "Member", member);
  const staffId = randomUUID();
  await insert(db, "StaffAccount", { id: staffId, email: "staff@example.test", emailKey: "staff@example.test", displayName: "確認スタッフ", passwordHash: "test-only-not-a-login-hash", updatedAt: now });
  const makeReservation = (roomId = seedIds.rooms[0] as string, therapistId = seedIds.therapists[0] as string, hour = 0) => ({
    id: randomUUID(), memberId, treatmentId: seedIds.treatments[0], roomId, therapistId,
    memberLastNameSnapshot: "予約", memberFirstNameSnapshot: "確認", memberEmailSnapshot: "fixture@example.test", memberPhoneNumberSnapshot: "09000000000",
    treatmentNameSnapshot: "ボディケア", treatmentDurationMinutesSnapshot: 60, treatmentPriceYenSnapshot: 6000, roomNameSnapshot: "施術ルーム1", therapistNameSnapshot: "施術者1",
    businessDate: "2026-10-01", startsAt: new Date(now.getTime() + hour * 3600000), treatmentEndsAt: new Date(now.getTime() + (hour * 60 + 70) * 60000), occupiesUntil: new Date(now.getTime() + (hour + 2) * 3600000), totalDurationMinutes: 70, totalPriceYen: 7000, slotCount: 2, version: 1, updatedAt: now,
  });
  const a = makeReservation();
  const b = makeReservation(seedIds.rooms[0], seedIds.therapists[1]);
  const c = makeReservation(seedIds.rooms[1], seedIds.therapists[0]);
  const d = makeReservation(seedIds.rooms[1], seedIds.therapists[1]);
  for (const row of [a,b,c,d]) await insert(db, "Reservation", row);
  const slot = (r: typeof a, hour: number) => ({ reservationId: r.id, roomId: r.roomId, therapistId: r.therapistId, slotStartsAt: new Date(now.getTime() + hour * 3600000) });
  await insert(db, "ReservationSlot", slot(a, 0));
  await insert(db, "ReservationSlot", slot(a, 1));
  const option = { reservationId: a.id, optionId: seedIds.options[0], optionNameSnapshot: "ヘッドマッサージ", optionDurationMinutesSnapshot: 10, optionPriceYenSnapshot: 1000 };
  await insert(db, "ReservationOption", option);
  const sessionId = randomUUID();
  await insert(db, "AppSession", { id: sessionId, principalType: "MEMBER", memberId, authVersion: 1, createdAt: now, expiresAt: new Date(now.getTime() + 3600000) });
  const ids: Record<string,string> = { Member: memberId, StaffAccount: staffId, AdminAccount: seedIds.admin, Room: seedIds.rooms[0], Therapist: seedIds.therapists[0], Treatment: seedIds.treatments[0], Option: seedIds.options[0], Reservation: a.id, ReservationOption: a.id, AppSession: sessionId, ReservationSlot: a.id };
  const keyFor = (table: string) => ["ReservationSlot","ReservationOption"].includes(table) ? "reservationId" : "id";
  async function invalid(table: string, name: string, changes: Record<string, unknown>) {
    const entries = Object.entries(changes);
    await rejected(db, () => db.query(`UPDATE ${quote(table)} SET ${entries.map(([k],i)=>`${quote(k)}=$${i+1}`).join(",")} WHERE ${quote(keyFor(table))}=$${entries.length+1}`, [...entries.map(([,v])=>v),ids[table]]), "23514", `${table}_${name}_check`);
  }
  await db.query("BEGIN");
  try {
    const names: Record<string,string[]> = { Member:["lastName","firstName","lastNameKey","firstNameKey","passwordHash"], StaffAccount:["displayName","passwordHash"], AdminAccount:["displayName"], Room:["name"], Therapist:["name"], Treatment:["name"], Option:["name"], Reservation:["memberLastNameSnapshot","memberFirstNameSnapshot","treatmentNameSnapshot","roomNameSnapshot","therapistNameSnapshot"], ReservationOption:["optionNameSnapshot"] };
    for (const [table,cols] of Object.entries(names)) for (const col of cols) await invalid(table,col,{[col]:" "});
    for (const table of ["Member","StaffAccount"]) {
      await invalid(table,"email",{email:"invalid",emailKey:"invalid"});
      await invalid(table,"emailKey",{emailKey:"DIFFERENT@example.test"});
      await invalid(table,"authVersion",{authVersion:0});
    }
    await invalid("Member","phoneNumber",{phoneNumber:"090-0000"});
    await invalid("Member","postalCode",{postalCode:"001-000"});
    await invalid("Member","ageBand",{ageBand:90});
    await invalid("Member","state",{isDeleted:true});
    await invalid("Member","state",{emailVerifiedAt:null});
    await invalid("Member","state",{firstActivatedAt:null});
    await invalid("AppSession","owner",{staffId});
    await invalid("AppSession","owner",{memberId:null});
    await invalid("AppSession","owner",{principalType:"ADMIN"});
    await invalid("AppSession","authVersion",{authVersion:0});
    await invalid("AppSession","times",{expiresAt:now});
    await invalid("AppSession","times",{revokedAt:new Date(now.getTime()-1)});
    await invalid("Reservation","memberEmailSnapshot",{memberEmailSnapshot:"invalid"});
    await invalid("Reservation","memberPhoneNumberSnapshot",{memberPhoneNumberSnapshot:"abc"});
    for (const [table,col,value] of [
      ["Treatment","durationMinutes",0], ["Option","durationMinutes",-1], ["Reservation","treatmentDurationMinutesSnapshot",0], ["ReservationOption","optionDurationMinutesSnapshot",-1],
      ["Treatment","priceYen",-1],["Option","priceYen",1000001],["Reservation","treatmentPriceYenSnapshot",-1],["Reservation","totalPriceYen",1000001],["ReservationOption","optionPriceYenSnapshot",-1],
      ["Reservation","version",0],
    ] as const) await invalid(table,col,{[col]:value});
    // Keep other dependent values consistent to exercise this specific CHECK.
    await invalid("Reservation","durationBounds",{totalDurationMinutes:0,slotCount:1,treatmentEndsAt:now,occupiesUntil:new Date(now.getTime()+3600000)});
    await invalid("Reservation","slotCount",{slotCount:1,occupiesUntil:new Date(now.getTime()+3600000)});
    await invalid("Reservation","times",{treatmentEndsAt:now});
    await invalid("Reservation","businessDate",{businessDate:"2026-10-02"});
    // 1ms shift preserves duration but violates hour alignment.
    await invalid("Reservation","startsAt",{startsAt:new Date(now.getTime()+1),treatmentEndsAt:new Date(a.treatmentEndsAt.getTime()+1),occupiesUntil:new Date(a.occupiesUntil.getTime()+1)});
    for (const delta of [1,1000,30*60000]) await rejected(db,()=>insert(db,"ReservationSlot",{...slot(d,0),slotStartsAt:new Date(now.getTime()+delta)}),"23514","ReservationSlot_slotStartsAt_check");
    await rejected(db,()=>insert(db,"ReservationSlot",slot(b,0)),"23505","ReservationSlot_roomId_slotStartsAt_key");
    await rejected(db,()=>insert(db,"ReservationSlot",slot(c,0)),"23505","ReservationSlot_therapistId_slotStartsAt_key");
    await rejected(db,()=>insert(db,"ReservationSlot",slot(a,0)),"23505");
    for (const change of [{reservationId:randomUUID()},{roomId:seedIds.rooms[1]},{therapistId:seedIds.therapists[1]}]) await rejected(db,()=>insert(db,"ReservationSlot",{...slot(a,3),...change}),"23503");
    await rejected(db,()=>insert(db,"ReservationOption",option),"23505");
    await rejected(db,()=>insert(db,"Member",{...member,id:randomUUID()}),"23505");
    await rejected(db,()=>db.query('UPDATE "Member" SET status=\'UNKNOWN\' WHERE id=$1',[memberId]),"22P02");
    await rejected(db,()=>db.query('UPDATE "Reservation" SET "memberId"=NULL WHERE id=$1',[a.id]),"23502");
    await rejected(db,()=>db.query('UPDATE "Reservation" SET "memberEmailSnapshot"=NULL WHERE id=$1',[a.id]),"23502");
    await rejected(db,()=>db.query('UPDATE "Member" SET "lastName"=$1 WHERE id=$2',["名".repeat(101),memberId]),"22001");
    for(const table of ["Member","Treatment","Room","Therapist","Option","Reservation"]) {
      await rejected(db,()=>db.query(`DELETE FROM ${quote(table)} WHERE id=$1`,[ids[table]]),"23503");
      await rejected(db,()=>db.query(`UPDATE ${quote(table)} SET id=$1 WHERE id=$2`,[randomUUID(),ids[table]]),"23503");
    }
    await rejected(db,()=>db.query('UPDATE "Reservation" SET "roomId"=$1 WHERE id=$2',[seedIds.rooms[1],a.id]),"23503");
    // Valid: distinct resources, adjacent hour and next day's same hour.
    await insert(db,"ReservationSlot",slot(d,0));
    await insert(db,"ReservationSlot",slot(a,2));
    await insert(db,"ReservationSlot",slot(a,24));
    // FK does not assert slot coverage; deliberately demonstrates that boundary.
    await insert(db,"ReservationOption",{...option,optionId:seedIds.options[2],optionDurationMinutesSnapshot:0,optionPriceYenSnapshot:0});
    await db.query('UPDATE "Member" SET status=\'WITHDRAWN\', "isDeleted"=true, "lastName"=\'変更後\', email=\'changed@example.test\', "emailKey"=\'changed@example.test\' WHERE id=$1',[memberId]);
    for(const table of ["Room","Therapist","Treatment","Option"]) await db.query(`UPDATE ${quote(table)} SET "isActive"=false, name='変更後' WHERE id=$1`,[ids[table]]);
    await db.query('UPDATE "Treatment" SET "durationMinutes"=90,"priceYen"=8000 WHERE id=$1',[seedIds.treatments[0]]);
    await db.query('UPDATE "Option" SET "durationMinutes"=20,"priceYen"=2000 WHERE id=$1',[seedIds.options[0]]);
    assert.deepEqual((await db.query('SELECT "optionNameSnapshot","optionDurationMinutesSnapshot","optionPriceYenSnapshot" FROM "ReservationOption" WHERE "reservationId"=$1 AND "optionId"=$2',[a.id,seedIds.options[0]])).rows[0],{optionNameSnapshot:"ヘッドマッサージ",optionDurationMinutesSnapshot:10,optionPriceYenSnapshot:1000});
    const snapshot = (await db.query('SELECT "memberLastNameSnapshot", "treatmentNameSnapshot", "totalPriceYen" FROM "Reservation" WHERE id=$1',[a.id])).rows[0];
    assert.deepEqual(snapshot,{memberLastNameSnapshot:"予約",treatmentNameSnapshot:"ボディケア",totalPriceYen:7000});
    const checks = (await db.query("SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND contype='c'",[schema])).rows;
    for (const name of checked) if (name.endsWith("_check")) assert(checks.some(r => r.conname === name));
    passed += 6;
  } finally { await db.query("ROLLBACK"); }

  // New booking: first slot inserted, second slot conflicts; rollback both parent and first slot.
  const e = makeReservation(seedIds.rooms[0],seedIds.therapists[1],-1);
  e.businessDate = "2026-10-01";
  await db.query("BEGIN");
  try {
    await insert(db,"Reservation",e);
    await insert(db,"ReservationSlot",slot(e,-1));
    await assert.rejects(()=>insert(db,"ReservationSlot",slot(e,0)),(err:unknown)=>(err as DatabaseError).code==="23505");
  } finally { await db.query("ROLLBACK"); }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "Reservation" WHERE id=$1',[e.id])).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "ReservationSlot" WHERE "reservationId"=$1',[e.id])).rows[0].n,0);
  // Failed move restores the original assignment and both original slots.
  await insert(db,"ReservationSlot",slot(d,1));
  await db.query("BEGIN");
  try {
    await db.query('DELETE FROM "ReservationSlot" WHERE "reservationId"=$1',[a.id]);
    await db.query('UPDATE "Reservation" SET "roomId"=$1,"therapistId"=$2 WHERE id=$3',[d.roomId,d.therapistId,a.id]);
    await insert(db,"ReservationSlot",{...slot(a,0),roomId:d.roomId,therapistId:d.therapistId});
    await assert.rejects(()=>insert(db,"ReservationSlot",{...slot(a,1),roomId:d.roomId,therapistId:d.therapistId}),(err:unknown)=>(err as DatabaseError).code==="23505");
  } finally { await db.query("ROLLBACK"); }
  assert.deepEqual((await db.query('SELECT "roomId","therapistId" FROM "Reservation" WHERE id=$1',[a.id])).rows[0],{roomId:a.roomId,therapistId:a.therapistId});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "ReservationSlot" WHERE "reservationId"=$1',[a.id])).rows[0].n,2);
  // Two actual concurrent transactions compete for the same previously free hour.
  const other = new Client({connectionString});
  await other.connect();
  try {
    await other.query(`SET search_path TO ${quote(schema)}`);
    await db.query("BEGIN"); await other.query("BEGIN");
    await insert(db,"ReservationSlot",slot(a,4));
    const loser = assert.rejects(()=>insert(other,"ReservationSlot",slot(b,4)),(err:unknown)=>(err as DatabaseError).code==="23505");
    await db.query("COMMIT"); await loser;
    await other.query("ROLLBACK");
  } finally { await other.end(); }
  // Successful move: delete old occupancy, update assignment/time, then create all new slots.
  await db.query("BEGIN");
  try {
    await db.query('DELETE FROM "ReservationSlot" WHERE "reservationId"=$1',[a.id]);
    await db.query('UPDATE "Reservation" SET "therapistId"=$1,"therapistNameSnapshot"=$2,"startsAt"=$3,"treatmentEndsAt"=$4,"occupiesUntil"=$5 WHERE id=$6',[b.therapistId,"施術者2",new Date(now.getTime()+2*3600000),new Date(now.getTime()+190*60000),new Date(now.getTime()+4*3600000),a.id]);
    for(const hour of [2,3]) await insert(db,"ReservationSlot",{...slot(a,hour),therapistId:b.therapistId});
    await db.query("COMMIT");
  } catch(error) { await db.query("ROLLBACK"); throw error; }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "ReservationSlot" WHERE "reservationId"=$1 AND "therapistId"=$2',[a.id,b.therapistId])).rows[0].n,2);
  passed++;
  // Cancellation deletes occupancy only; completed reservation retains original slots.
  const cancellationAuditId = randomUUID();
  await db.query("BEGIN");
  await insert(db, "AuditLog", {id:cancellationAuditId,requestKey:randomUUID(),actorType:"SYSTEM",action:"reservation.cancel",targetType:"Reservation",targetId:a.id});
  await db.query('UPDATE "Reservation" SET status=\'CANCELLED\', "cancelledAt"=$2,"cancellationKind"=\'NORMAL\',"cancellationAuditId"=$3 WHERE id=$1',[a.id,now,cancellationAuditId]);
  await db.query('DELETE FROM "ReservationSlot" WHERE "reservationId"=$1',[a.id]);
  await db.query("COMMIT");
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "ReservationOption" WHERE "reservationId"=$1',[a.id])).rows[0].n,1);
  await db.query('UPDATE "Reservation" SET status=\'COMPLETED\',"actualStartedAt"=$2,"actualCompletedAt"=$3 WHERE id=$1',[d.id,now,new Date(now.getTime()+70*60000)]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "ReservationSlot" WHERE "reservationId"=$1',[d.id])).rows[0].n,1);
  passed += 5;
}

async function main() {
  const connectionString = loadDevelopmentDatabase();
  const db = new Client({ connectionString, connectionTimeoutMillis:5000, statement_timeout:15000 });
  await db.connect();
  let baseline: unknown;
  try {
    for (let round=0;round<2;round++) {
      // Only drop schemas successfully created by this invocation; never public.
      const schema=`booking_verify_${randomUUID().replaceAll("-", "")}`;
      assert.match(schema,/^booking_verify_[a-f0-9]{32}$/);
      await db.query(`CREATE SCHEMA ${quote(schema)}`);
      let prisma: PrismaClient | undefined;
      try {
        const url=new URL(connectionString); url.searchParams.set("schema",schema);
        runPrisma(["migrate","deploy"],url.href);
        runPrisma(["migrate","deploy"],url.href);
        runPrisma(["migrate","status"],url.href);
        await db.query(`SET search_path TO ${quote(schema)}`);
        prisma=new PrismaClient({adapter:new PrismaPg({connectionString},{schema})});
        await seedDevelopment(prisma);
        await seedDevelopment(prisma);
        const counts = await Promise.all([prisma.adminAccount.count(),prisma.room.count(),prisma.therapist.count(),prisma.treatment.count(),prisma.option.count(),prisma.member.count(),prisma.reservation.count()]);
        assert.deepEqual(counts,[1,2,2,3,3,0,0]);
        const constraints=(await db.query("SELECT c.relname, x.conname, pg_get_constraintdef(x.oid) AS definition FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,x.conname",[schema])).rows;
        const indexes=(await db.query("SELECT indexname, replace(indexdef, $1 || '.', '') AS definition FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname",[schema])).rows;
        const columns=(await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position",[schema])).rows;
        const catalog={constraints,indexes,columns};
        assert.deepEqual(await prisma.treatment.findMany({select:{name:true,durationMinutes:true,priceYen:true},orderBy:{id:"asc"}}),[
          {name:"ボディケア",durationMinutes:60,priceYen:6000},{name:"オイルマッサージ",durationMinutes:90,priceYen:9000},{name:"全身コース",durationMinutes:120,priceYen:12000},
        ]);
        if(round===0) baseline=catalog; else assert.deepEqual(catalog,baseline);
        await prisma.room.update({where:{id:seedIds.rooms[0]},data:{name:"編集済み",isActive:false}});
        await seedDevelopment(prisma);
        const room=await prisma.room.findUniqueOrThrow({where:{id:seedIds.rooms[0]}});
        assert.equal(room.name,"編集済み");assert.equal(room.isActive,false);
        passed += 4;
        if(round===0) {
          await verifyConstraints(db,schema,connectionString);
          passed += await verifyOperationalModels(db, checked);
          passed += await verifyEffectiveSchedules(db, prisma, checked);
          const names=(await db.query("SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND contype='c'",[schema])).rows.map(r=>r.conname).sort();
          assert.deepEqual(names,[...checked].filter(n=>n.endsWith("_check")).sort());
        }
        console.log(`Isolated database round ${round+1}: migrations, repeated seed and catalog verification passed.`);
      } finally {
        await prisma?.$disconnect();
        await db.query("ROLLBACK");
        await db.query('SET search_path TO public');
        await db.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
      }
    }
    console.log(`Database verification passed: ${passed} cases; all ${[...checked].filter(n=>n.endsWith("_check")).length} CHECK constraints exercised; isolated schemas removed.`);
  } finally { await db.end(); }
}
main().catch((error: unknown)=>{
  // Do not emit driver details (they may contain row data or credentials).
  console.error("Database verification failed.", error instanceof assert.AssertionError ? `Assertion: ${error.message}` : "Check local service and migration SQL.");
  process.exitCode=1;
});
