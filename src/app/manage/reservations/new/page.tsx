import Link from "next/link";
import { redirect } from "next/navigation";
import { ManageReservationForm } from "@/components/manage-reservation-form";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let access;
  try {
    access = await getStoreCapabilities();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return (
      <main className="p-6">
        画面を表示できません。時間をおいて再読み込みしてください。
      </main>
    );
  }
  if (
    access.principal.role !== "ADMIN" &&
    !access.permissions.includes("RESERVATION_CREATE")
  )
    return <main className="p-6">予約を登録する権限がありません。</main>;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link className="underline" href="/manage/reservations">
        ← 予約一覧
      </Link>
      <h1 className="text-2xl font-bold">会員の予約を登録</h1>
      <p>
        予約可能な既存会員を選択してください。保存時に会員状態、メニュー、時間、部屋・施術者の全占有枠を再確認します。
      </p>
      <ManageReservationForm canException={false} />
    </main>
  );
}
