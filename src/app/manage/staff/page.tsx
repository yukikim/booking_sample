import Link from "next/link";
import { redirect } from "next/navigation";
import { StoreAccessError } from "@/lib/auth/permissions";
import { getStaffRoster } from "@/lib/manage/staff-roster";
import { StaffCreateForm } from "@/components/staff-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let staff;
  try { staff = await getStaffRoster(); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/admin/login");
    if (error instanceof StoreAccessError && error.status === 403) return <main className="p-8"><h1>スタッフ一覧を閲覧する権限がありません</h1></main>;
    return <main className="p-8"><h1>現在、スタッフ一覧を表示できません</h1><p>時間をおいて再読み込みしてください。</p></main>;
  }
  return <main className="mx-auto max-w-2xl space-y-6 p-8">
    <h1 className="text-2xl font-bold">スタッフ一覧</h1>
    <StaffCreateForm isAdmin />
    <p>登録日の新しい順に最大50件を表示します。</p>
    <ul className="space-y-3">{staff.map((person) => <li className="rounded border p-3" key={person.id}>
      <p className="font-medium">{person.displayName} {person.isActive ? "" : "（無効）"}</p>
      <p>{person.email}</p>
      <Link href={`/manage/staff/${person.id}`} className="underline">権限を設定</Link>
    </li>)}</ul>
    {staff.length === 0 && <p>スタッフはまだ登録されていません。</p>}
    <Link href="/manage" className="underline">店舗画面へ戻る</Link>
  </main>;
}
