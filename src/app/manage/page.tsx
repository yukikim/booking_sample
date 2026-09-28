import { redirect } from "next/navigation";
import { getStoreSession } from "@/auth";
import { LogoutButton } from "@/components/auth/login-form";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page() {
  let session;
  try { session = await getStoreSession(); }
  catch { return <main className="p-8"><h1>認証情報を確認できません</h1><p>時間をおいて再読み込みしてください。</p></main>; }
  if (!session) redirect("/staff/login");
  return <main className="mx-auto max-w-xl space-y-6 p-8"><h1 className="text-2xl font-bold">店舗画面</h1><p>{session.user.role === "ADMIN" ? "管理者" : "スタッフ"}としてログインしています。</p><p>有効期限：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(session.expires))}</p><p>予約や店舗設定の管理機能は、今後の開発で追加します。</p><LogoutButton /></main>;
}
