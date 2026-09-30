import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ManageReservationForm } from "@/components/manage-reservation-form";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { getStoreReservation } from "@/lib/manage/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ storeException?: string }>;
}) {
  let access;
  let reservation;
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
    !access.permissions.includes("RESERVATION_UPDATE")
  )
    return <main className="p-6">予約を変更する権限がありません。</main>;
  try {
    reservation = await getStoreReservation((await params).id);
  } catch {
    return (
      <main className="p-6">
        予約を表示できません。時間をおいて再読み込みしてください。
      </main>
    );
  }
  if (!reservation) notFound();
  if (reservation.status !== "CONFIRMED")
    return (
      <main className="p-6">
        <p>確定予約だけを変更できます。</p>
        <Link
          className="underline"
          href={`/manage/reservations/${reservation.id}`}
        >
          予約詳細へ
        </Link>
      </main>
    );
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link
        className="underline"
        href={`/manage/reservations/${reservation.id}`}
      >
        ← 予約詳細
      </Link>
      <h1 className="text-2xl font-bold">予約を変更</h1>
      <p>
        別画面で予約が変更された場合は保存を拒否します。部屋・担当を指定する場合も全占有枠を再確認します。
      </p>
      <ManageReservationForm
        edit={{
          id: reservation.id,
          version: reservation.version,
          date: reservation.businessDate.toISOString().slice(0, 10),
          startsAt: reservation.startsAt.toISOString(),
          treatmentId: reservation.treatmentId,
          optionIds: reservation.options.map((option) => option.optionId),
          notes: reservation.notes ?? "",
          roomId: reservation.roomId,
          therapistId: reservation.therapistId,
          memberName: `${reservation.memberLastNameSnapshot} ${reservation.memberFirstNameSnapshot}`,
        }}
        canException={
          access.principal.role === "ADMIN" ||
          access.permissions.includes("RESERVATION_EXCEPTION")
        }
        initialException={(await searchParams).storeException === "true"}
      />
    </main>
  );
}
