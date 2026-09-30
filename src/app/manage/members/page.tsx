import Link from "next/link";
import { redirect } from "next/navigation";
import { StoreAccessError } from "@/lib/auth/permissions";
import { memberManagementAccess } from "@/lib/manage/members";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const statuses = ["PENDING_EMAIL", "PENDING_REVIEW", "REJECTED", "ACTIVE", "WITHDRAWN", "RESTORE_PENDING"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  let access;
  try { access = await memberManagementAccess(); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-8">会員管理の権限がありません。</main>;
  }
  const params = await searchParams;
  const raw = params.query;
  const query = typeof raw === "string" ? raw.trim() : "";
  const status = params.status;
  const invalid = (raw !== undefined && (typeof raw !== "string" || [...query].length < 2 || [...query].length > 100)) || (status !== undefined && (typeof status !== "string" || !statuses.includes(status as typeof statuses[number])));
  const members = invalid ? [] : await getPrisma().member.findMany({
    where: { ...(status ? { status: status as typeof statuses[number] } : {}), ...(query ? { OR: [{ lastName: { contains: query, mode: "insensitive" } }, { firstName: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { phoneNumber: { contains: query } }] } : {}) },
    select: { id: true, lastName: true, firstName: true, email: true, status: true, isDeleted: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 50,
  });
  return <main className="mx-auto max-w-4xl space-y-5 p-8">
    <h1 className="text-2xl font-bold">会員検索・状態確認</h1>
    <form className="flex flex-wrap items-end gap-3" method="get">
      <label>氏名・メール・電話番号（2文字以上）<input className="block rounded border p-2" name="query" defaultValue={query} /></label>
      <label>状態<select className="block rounded border p-2" name="status" defaultValue={typeof status === "string" ? status : ""}><option value="">すべて</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="rounded border px-4 py-2" type="submit">検索</button>
    </form>
    {invalid && <p role="alert">検索条件を確認してください。氏名・メール・電話番号は2〜100文字です。</p>}
    {!invalid && <p>{members.length}件表示（最大50件）</p>}
    {!invalid && <ul className="space-y-2">{members.map(member => <li className="rounded border p-3" key={member.id}><Link className="underline" href={`/manage/members/${member.id}`}>{member.lastName} {member.firstName}／{member.email}</Link><span className="ml-3">{member.status}{member.isDeleted ? "・論理削除済み" : ""}</span></li>)}</ul>}
    {access.isAdmin && <Link className="block underline" href="/manage/members/reviews">氏名一致の審査</Link>}
    <Link className="block underline" href="/manage">店舗画面へ戻る</Link>
  </main>;
}
