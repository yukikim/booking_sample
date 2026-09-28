import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StaffPermissionForm } from "@/components/staff-management";
import { StoreAccessError, requireStoreAction } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  try { await requireStoreAction("STAFF_PERMISSION_MANAGE"); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/admin/login");
    if (error instanceof StoreAccessError && error.status === 403) return <main className="p-8">権限を設定できません。</main>;
    return <main className="p-8">認証情報を確認できません。時間をおいて再読み込みしてください。</main>;
  }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const staff = await getPrisma().staffAccount.findUnique({ where: { id }, select: { id: true, displayName: true, email: true, isActive: true, permissions: { select: { permission: true } } } });
  if (!staff) notFound();
  return <main className="mx-auto max-w-2xl space-y-6 p-8">
    <h1 className="text-2xl font-bold">{staff.displayName} の権限</h1>
    <p>{staff.email} {staff.isActive ? "" : "（無効）"}</p>
    <StaffPermissionForm staffId={staff.id} initial={staff.permissions.map((row) => row.permission)} />
    <Link href="/manage/staff" className="underline">スタッフ一覧へ戻る</Link>
  </main>;
}
