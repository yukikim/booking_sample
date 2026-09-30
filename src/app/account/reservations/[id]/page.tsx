import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/auth/member";
import { getMemberReservation } from "@/lib/booking/member-reservations";
import { formatTokyo, reservationStatus } from "@/lib/booking/display";
import { CancelReservationButton } from "@/components/cancel-reservation-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let reservation;
  try {
    reservation = await getMemberReservation((await params).id);
  } catch (error) {
    if (error instanceof MemberAccessError && error.status === 401)
      redirect("/login");
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-bold">予約詳細を表示できません</h1>
        <p>
          {error instanceof MemberAccessError && error.status === 403
            ? "アカウント状態を確認してください。"
            : "現在予約を取得できません。時間をおいて再試行してください。"}
        </p>
        <Link className="text-blue-700 underline" href="/account">
          マイページへ戻る
        </Link>
      </main>
    );
  }
  if (!reservation) notFound();
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link className="text-blue-700 underline" href="/account">
        ← 予約一覧へ
      </Link>
      <h1 className="text-2xl font-bold">予約詳細</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded border p-4">
        <dt>予約番号</dt>
        <dd className="break-all font-mono">{reservation.id}</dd>
        <dt>状態</dt>
        <dd>{reservationStatus(reservation.status)}</dd>
        <dt>日時</dt>
        <dd>
          {formatTokyo(reservation.startsAt)}〜
          {formatTokyo(reservation.treatmentEndsAt)}
        </dd>
        <dt>メニュー</dt>
        <dd>
          {reservation.treatmentNameSnapshot}（
          {reservation.treatmentDurationMinutesSnapshot}分・
          {reservation.treatmentPriceYenSnapshot.toLocaleString("ja-JP")}円）
        </dd>
        <dt>オプション</dt>
        <dd>
          {reservation.options.length ? (
            <ul>
              {reservation.options.map((option) => (
                <li key={option.optionId}>
                  {option.optionNameSnapshot}（
                  {option.optionDurationMinutesSnapshot}分・
                  {option.optionPriceYenSnapshot.toLocaleString("ja-JP")}円）
                </li>
              ))}
            </ul>
          ) : (
            "なし"
          )}
        </dd>
        <dt>合計</dt>
        <dd>
          {reservation.totalDurationMinutes}分・
          {reservation.totalPriceYen.toLocaleString("ja-JP")}円（税込）
        </dd>
        <dt>部屋</dt>
        <dd>{reservation.roomNameSnapshot}</dd>
        <dt>担当</dt>
        <dd>{reservation.therapistNameSnapshot}</dd>
        <dt>お名前</dt>
        <dd>
          {reservation.memberLastNameSnapshot}{" "}
          {reservation.memberFirstNameSnapshot}
        </dd>
        <dt>連絡先</dt>
        <dd>
          {reservation.memberEmailSnapshot}／
          {reservation.memberPhoneNumberSnapshot}
        </dd>
        <dt>備考</dt>
        <dd className="whitespace-pre-wrap">{reservation.notes || "なし"}</dd>
        {reservation.cancelledAt && (
          <>
            <dt>取消日時</dt>
            <dd>{formatTokyo(reservation.cancelledAt)}</dd>
          </>
        )}
      </dl>
      {reservation.status === "CONFIRMED" && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">キャンセル</h2>
          <p>
            {reservation.cancellationDeadline
              ? `通常キャンセル期限：${formatTokyo(reservation.cancellationDeadline)}まで`
              : "通常キャンセル期限を確認できません。"}
          </p>
          {reservation.canCancel ? (
            <CancelReservationButton
              key={`${reservation.id}:${reservation.version}`}
              id={reservation.id}
              version={reservation.version}
              deadline={reservation.cancellationDeadline!}
            />
          ) : (
            <p>
              通常キャンセルの受付期限を過ぎています。店舗にご連絡ください。
            </p>
          )}
        </section>
      )}
    </main>
  );
}
