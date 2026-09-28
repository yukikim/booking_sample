import Link from "next/link";
import { redirect } from "next/navigation";
import { ResourceManager } from "@/components/resource-manager";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { listResources } from "@/lib/manage/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let access;
  let resources;
  try {
    access = await getStoreCapabilities();
    resources = await listResources();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-8">部屋・施術者を表示できません。時間をおいて再読み込みしてください。</main>;
  }
  return <main className="mx-auto max-w-3xl space-y-8 p-8">
    <h1 className="text-2xl font-bold">部屋・施術者管理</h1>
    <p>予約に割り当てる部屋と施術者を個別に管理します。無効化した項目は履歴に残ります。</p>
    <p>未終了の予約に割り当てられている項目は、影響確認機能が追加されるまで無効化できません。</p>
    <ResourceManager kind="rooms" items={resources.rooms} permissions={access.permissions} />
    <ResourceManager kind="therapists" items={resources.therapists} permissions={access.permissions} />
    <p>施術者の曜日別休憩が未設定の日は、新規予約の割当対象になりません。休憩設定は次のTaskで追加します。</p>
    <Link href="/manage" className="underline">店舗画面へ戻る</Link>
  </main>;
}
