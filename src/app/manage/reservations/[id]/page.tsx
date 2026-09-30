import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StoreAccessError } from "@/lib/auth/permissions";
import { formatTokyo, reservationStatus } from "@/lib/booking/display";
import { getStoreReservation } from "@/lib/manage/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  let reservation;
  try { reservation = await getStoreReservation((await params).id); }
  catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-6">予約詳細を表示できません。時間をおいて再読み込みしてください。</main>;
  }
  if (!reservation) notFound();
  const yen = (value: number) => `${value.toLocaleString("ja-JP")}円`;
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <Link className="underline" href={`/manage/reservations?date=${reservation.businessDate.toISOString().slice(0, 10)}`}>← 予約一覧へ</Link>
    <h1 className="text-2xl font-bold">予約詳細</h1>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded border p-4">
      <dt>予約番号</dt><dd className="break-all font-mono">{reservation.id}</dd>
      <dt>状態</dt><dd>{reservationStatus(reservation.status)}</dd>
      <dt>施術予定</dt><dd>{formatTokyo(reservation.startsAt.toISOString())}〜{formatTokyo(reservation.treatmentEndsAt.toISOString())}</dd>
      <dt>占有終了予定</dt><dd>{formatTokyo(reservation.occupiesUntil.toISOString())}（{reservation.slotCount}枠）</dd>
      <dt>顧客</dt><dd>{reservation.memberLastNameSnapshot} {reservation.memberFirstNameSnapshot}</dd>
      <dt>会員ID</dt><dd className="break-all font-mono">{reservation.memberId}</dd>
      <dt>予約時の連絡先</dt><dd className="break-all">{reservation.memberEmailSnapshot}<br />{reservation.memberPhoneNumberSnapshot}</dd>
      <dt>予約時のメニュー</dt><dd>{reservation.treatmentNameSnapshot}（{reservation.treatmentDurationMinutesSnapshot}分・{yen(reservation.treatmentPriceYenSnapshot)}）</dd>
      <dt>予約時のオプション</dt><dd>{reservation.options.length ? <ul>{reservation.options.map(option => <li key={option.optionId}>{option.optionNameSnapshot}（{option.optionDurationMinutesSnapshot}分・{yen(option.optionPriceYenSnapshot)}）</li>)}</ul> : "なし"}</dd>
      <dt>合計</dt><dd>{reservation.totalDurationMinutes}分・{yen(reservation.totalPriceYen)}（税込）</dd>
      <dt>担当施術者</dt><dd>{reservation.therapistNameSnapshot}</dd>
      <dt>部屋</dt><dd>{reservation.roomNameSnapshot}</dd>
      <dt>備考</dt><dd className="whitespace-pre-wrap">{reservation.notes || "なし"}</dd>
      {reservation.actualStartedAt && <><dt>施術開始</dt><dd>{formatTokyo(reservation.actualStartedAt.toISOString())}</dd></>}
      {reservation.actualCompletedAt && <><dt>施術完了</dt><dd>{formatTokyo(reservation.actualCompletedAt.toISOString())}</dd></>}
      {reservation.cancelledAt && <><dt>取消日時</dt><dd>{formatTokyo(reservation.cancelledAt.toISOString())}</dd><dt>取消理由</dt><dd>{reservation.cancellationReason || "記録なし"}</dd></>}
    </dl>
  </main>;
}
