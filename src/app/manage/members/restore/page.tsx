import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";
import { RestoreMemberButton } from "@/components/restore-member-button";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page() {
  try { await requireStoreAction("MEMBER_RESTORE"); }
  catch (error) { if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login"); return <main className="p-8">会員復旧の権限がありません。</main>; }
  const members = await getPrisma().member.findMany({ where: { status: "WITHDRAWN", isDeleted: true, firstActivatedAt: { not: null } }, select: { id: true, email: true, lastName: true, firstName: true, version: true }, orderBy: { updatedAt: "desc" }, take: 100 });
  return <main className="mx-auto max-w-3xl space-y-5 p-8"><h1 className="text-2xl font-bold">退会済み会員の復旧</h1><p>復旧には会員本人のメール確認と新しいパスワード設定が必要です。取消済み予約は復活しません。</p>{members.length ? <ul className="space-y-4">{members.map((member) => <li key={member.id} className="space-y-2 rounded border p-4"><p>{member.lastName} {member.firstName}／{member.email}</p><RestoreMemberButton id={member.id} version={member.version} /></li>)}</ul> : <p>復旧可能な退会済み会員はありません。</p>}<Link href="/manage" className="underline">店舗画面へ戻る</Link></main>;
}
