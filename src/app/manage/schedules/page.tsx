import Link from "next/link";
import { redirect } from "next/navigation";
import { ScheduleManager } from "@/components/schedule-manager";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { listManagedSchedules } from "@/lib/schedules/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let access;
  let schedules;
  try {
    access = await getStoreCapabilities();
    schedules = await listManagedSchedules();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-8">営業・休憩設定を表示できません。時間をおいて再読み込みしてください。</main>;
  }
  return <main className="mx-auto max-w-4xl space-y-8 p-8">
    <h1 className="text-2xl font-bold">営業日・営業時間・休憩設定</h1>
    <p>週間営業、特定日の休業・営業時間、施術者ごとの曜日別1時間休憩を設定します。</p>
    <p>影響確認機能が完成するまでは、31日後以降で、対象期間に未終了予約がない変更だけを保存できます。</p>
    <ScheduleManager data={schedules} permissions={access.permissions} />
    <Link href="/manage" className="underline">店舗画面へ戻る</Link>
  </main>;
}
