import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ManageMemberActions } from "@/components/manage-member-actions";
import { StoreAccessError } from "@/lib/auth/permissions";
import { managedMemberDetail, memberManagementAccess } from "@/lib/manage/members";
import { formatTokyo } from "@/lib/booking/display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let access;
  let detail;
  try { access = await memberManagementAccess(); detail = await managedMemberDetail(id); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-8">会員情報を表示できません。</main>;
  }
  if (!detail) notFound();
  const { member, confirmed, grouped, lifecycle, reviewToken } = detail;
  return <main className="mx-auto max-w-4xl space-y-5 p-8">
    <h1 className="text-2xl font-bold">会員詳細</h1>
    <p>{member.lastName} {member.firstName}／{member.email}／{member.phoneNumber}</p>
    <p>状態：{member.status}{member.isDeleted ? "（論理削除済み）" : ""}／版：{member.version}</p>
    <p>予約履歴：{grouped.map(row => `${row.status} ${row._count._all}件`).join("、") || "なし"}</p>
    <section><h2 className="font-semibold">退会時に取消される確定予約</h2>{confirmed.length ? <ul className="list-disc pl-5">{confirmed.map(row => <li key={row.id}><Link className="underline" href={`/manage/reservations/${row.id}`}>{formatTokyo(row.startsAt.toISOString())} {row.treatmentNameSnapshot}</Link></li>)}</ul> : <p>なし</p>}</section>
    <ManageMemberActions id={id} version={member.version} status={member.status} isDeleted={member.isDeleted} canRestore={access.canRestore && !!member.firstActivatedAt} canForce={access.canForce} canDelete={access.canDelete} reviewToken={reviewToken} confirmedCount={confirmed.length} />
    <section><h2 className="font-semibold">会員状態の履歴（最新20件）</h2><ul className="list-disc pl-5">{lifecycle.map(row => <li key={row.id}>{formatTokyo(row.createdAt.toISOString())} {row.kind}{row.reason ? `：${row.reason}` : ""}</li>)}</ul></section>
    <Link className="block underline" href="/manage/members">会員検索へ戻る</Link>
  </main>;
}
