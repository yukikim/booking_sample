import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffCreateForm } from "@/components/staff-management";
import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let role: "ADMIN" | "STAFF";
  try { role = (await requireStoreAction("STAFF_CREATE")).role; }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    if (error instanceof StoreAccessError && error.status === 403) return <main className="p-8">スタッフ作成の権限がありません。</main>;
    return <main className="p-8">認証情報を確認できません。時間をおいて再読み込みしてください。</main>;
  }
  return <main className="mx-auto max-w-xl space-y-6 p-8"><h1 className="text-2xl font-bold">新しいスタッフ</h1><StaffCreateForm isAdmin={role === "ADMIN"} /><Link href="/manage" className="underline">店舗画面へ戻る</Link></main>;
}
