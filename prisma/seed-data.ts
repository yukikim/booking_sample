import type { PrismaClient } from "../src/generated/prisma/client";

export const seedIds = {
  admin: "00000000-0000-4000-8000-000000000001",
  rooms: ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"],
  therapists: ["00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000202"],
  treatments: ["00000000-0000-4000-8000-000000000301", "00000000-0000-4000-8000-000000000302", "00000000-0000-4000-8000-000000000303"],
  options: ["00000000-0000-4000-8000-000000000401", "00000000-0000-4000-8000-000000000402", "00000000-0000-4000-8000-000000000403"],
} as const;

/** Stable IDs + empty updates preserve local edits and disabled records. */
export async function seedDevelopment(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.adminAccount.upsert({ where: { id: seedIds.admin }, update: {}, create: { id: seedIds.admin, displayName: "管理者" } });
    for (const [i, id] of seedIds.rooms.entries()) {
      await tx.room.upsert({ where: { id }, update: {}, create: { id, name: `施術ルーム${i + 1}` } });
    }
    for (const [i, id] of seedIds.therapists.entries()) {
      await tx.therapist.upsert({ where: { id }, update: {}, create: { id, name: `施術者${i + 1}` } });
    }
    const treatments = [["ボディケア", 60, 6000], ["オイルマッサージ", 90, 9000], ["全身コース", 120, 12000]] as const;
    for (const [i, [name, durationMinutes, priceYen]] of treatments.entries()) {
      const id = seedIds.treatments[i];
      await tx.treatment.upsert({ where: { id }, update: {}, create: { id, name, durationMinutes, priceYen } });
    }
    const options = [["ヘッドマッサージ", 10, 1000], ["足つぼ", 20, 2000], ["ホットストーン", 0, 500]] as const;
    for (const [i, [name, durationMinutes, priceYen]] of options.entries()) {
      const id = seedIds.options[i];
      await tx.option.upsert({ where: { id }, update: {}, create: { id, name, durationMinutes, priceYen } });
    }
  });
}
