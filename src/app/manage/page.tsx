import Link from "next/link";
import { redirect } from "next/navigation";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/login-form";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page() {
  let access;
  try { access = await getStoreCapabilities(); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    if (error instanceof StoreAccessError && error.status === 403) return <main className="p-8"><h1>この画面を閲覧する権限がありません</h1></main>;
    return <main className="p-8"><h1>認証情報を確認できません</h1><p>時間をおいて再読み込みしてください。</p></main>;
  }
  return <main className="mx-auto max-w-xl space-y-6 p-8">
    <h1 className="text-2xl font-bold">店舗画面</h1>
    <p>{access.principal.role === "ADMIN" ? "管理者" : "スタッフ"}としてログインしています。</p>
    <p>有効期限：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(access.principal.expires))}</p>
    {access.canManagePermissions
      ? <Link href="/manage/staff" className="underline">スタッフ一覧</Link>
      : <p>{access.permissions.length === 0 ? "現在は閲覧のみ可能です。" : `更新操作の権限が${access.permissions.length}件設定されています。`}</p>}
    {(access.canManagePermissions || access.permissions.includes("STAFF_CREATE")) && <Link href="/manage/staff/new" className="block underline">スタッフを作成</Link>}
    <Link href="/manage/catalog" className="block underline">施術メニュー・オプション</Link>
    <Link href="/manage/resources" className="block underline">部屋・施術者</Link>
    <p>予約やその他の店舗設定機能は、今後の開発で追加します。</p>
    <LogoutButton />
  </main>;
}
