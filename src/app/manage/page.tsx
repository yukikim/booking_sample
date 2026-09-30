import Link from "next/link";
import { redirect } from "next/navigation";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/login-form";
import { getPrisma } from "@/lib/prisma";
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
  const adjustmentCount = await getPrisma().reservationChangeNotice.count({ where: { resolvedAt: null, responseStatus: { not: "RESOLVED" } } });
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
    <Link href="/manage/schedules" className="block underline">営業日・営業時間・休憩</Link>
    <Link href="/manage/reservations" className="block underline">予約一覧・カレンダー</Link>
    <Link href="/manage/adjustments" className="block underline">要調整・確認待ちの予約：{adjustmentCount}件</Link>
    {(access.principal.role === "ADMIN" || access.permissions.includes("MEMBER_RESTORE")) && <Link href="/manage/members/restore" className="block underline">退会済み会員の復旧</Link>}
    <p>予約の登録・変更・取消などの操作は、今後の開発で追加します。</p>
    <LogoutButton />
  </main>;
}
