import { redirect } from "next/navigation";
import { requireBookableMember, MemberAccessError } from "@/lib/auth/member";
import { LogoutButton } from "@/components/auth/login-form";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page() {
  try { await requireBookableMember(); }
  catch (error) { if (error instanceof MemberAccessError && error.status === 401) redirect("/login"); return <main className="p-8"><h1>会員画面を表示できません</h1><p>アカウント状態を確認してください。</p></main>; }
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="text-2xl font-bold">会員ページ</h1><p>ログイン中です。予約機能はEpic 4で追加します。</p><LogoutButton target="/login" /></main>;
}
