import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { adjustmentCandidates } from "@/lib/manage/adjustment-candidates";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { formatTokyo } from "@/lib/booking/display";
import { NoticeSendButton } from "@/components/notice-send-button";
import { AdjustmentResponseForm } from "@/components/adjustment-response-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let access;
  try {
    access = await getStoreCapabilities();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return <main className="p-8">要調整を表示できません。</main>;
  }
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const detail = await getPrisma().$transaction(
    async (tx) => {
      await setTransactionSchema(tx);
      const notice = await tx.reservationChangeNotice.findUnique({
        where: { id },
        include: {
          reservation: { include: { options: { select: { optionId: true } } } },
          changeAudit: { select: { action: true } },
          deliveries: {
            where: { kind: "RESERVATION_CHANGE" },
            include: {
              attempts: {
                select: { attemptNumber: true, result: true, errorCode: true },
              },
            },
          },
        },
      });
      if (!notice) return null;
      return {
        notice,
        candidates: await adjustmentCandidates(tx, notice.reservation),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!detail) notFound();
  const { notice, candidates } = detail;
  const reservation = notice.reservation;
  const canSend =
    access.principal.role === "ADMIN" ||
    access.permissions.includes("NOTICE_SEND");
  const canRespond =
    access.principal.role === "ADMIN" ||
    access.permissions.includes("NOTICE_UPDATE_RESPONSE");
  const canUpdate =
    access.principal.role === "ADMIN" ||
    access.permissions.includes("RESERVATION_UPDATE");
  const canCancel =
    access.principal.role === "ADMIN" ||
    access.permissions.includes("RESERVATION_CANCEL");
  const canResolve =
    notice.responseStatus === "IMPACT_RESOLVED_PENDING_REVIEW" ||
    reservation.status !== "CONFIRMED" ||
    reservation.version !== notice.reservationVersion;
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-8">
      <Link className="underline" href="/manage/adjustments">
        ← 要調整一覧
      </Link>
      <h1 className="text-2xl font-bold">要調整の詳細</h1>
      <p>
        予約：
        <Link
          className="underline"
          href={`/manage/reservations/${reservation.id}`}
        >
          {reservation.id}
        </Link>
        ／{formatTokyo(reservation.startsAt.toISOString())}／
        {reservation.status}
      </p>
      <p>
        顧客：{reservation.memberLastNameSnapshot}{" "}
        {reservation.memberFirstNameSnapshot}／{reservation.memberEmailSnapshot}
        ／{reservation.memberPhoneNumberSnapshot}
      </p>
      <p>
        影響：{notice.reason}／原因操作：{notice.changeAudit.action}
      </p>
      <p>
        配信状態：{notice.deliveries[0]?.status ?? "未依頼"}／顧客対応状態：
        {notice.responseStatus}
      </p>
      {notice.responseNote && <p>対応記録：{notice.responseNote}</p>}
      {notice.deliveries[0]?.attempts.length ? (
        <p>
          送信試行：
          {notice.deliveries[0].attempts
            .map(
              (row) =>
                `${row.attemptNumber}回目 ${row.result ?? "処理中"}${row.errorCode ? `（${row.errorCode}）` : ""}`,
            )
            .join("、")}
        </p>
      ) : null}
      <section className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">
          同日の空き候補（元の開始時刻の前後2時間）
        </h2>
        {candidates.length ? (
          <ul className="list-disc pl-5">
            {candidates.map((row) => (
              <li key={row.startsAt}>
                {formatTokyo(row.startsAt)}〜{formatTokyo(row.treatmentEndsAt)}
                （占有終了 {formatTokyo(row.occupiesUntil)}）
              </li>
            ))}
          </ul>
        ) : (
          <p>
            この範囲に空き候補はありません。別日時または取消について顧客と相談してください。
          </p>
        )}
        <p>
          候補は仮押さえではありません。候補の有無にかかわらず店舗への連絡を案内し、確定時に再検証します。
        </p>
      </section>
      {!notice.resolvedAt &&
        notice.responseStatus !== "IMPACT_RESOLVED_PENDING_REVIEW" &&
        !notice.deliveries.length &&
        canSend &&
        reservation.status === "CONFIRMED" && (
          <NoticeSendButton id={id} version={notice.version} />
        )}
      {!notice.resolvedAt && canRespond && (
        <AdjustmentResponseForm
          id={id}
          version={notice.version}
          current={notice.responseStatus}
          canResolve={canResolve}
        />
      )}
      {!notice.resolvedAt && reservation.status === "CONFIRMED" && (
        <section className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">顧客の依頼後に店舗で確定</h2>
          <p>
            日時・担当の変更または取消は、予約画面で再検証して保存します。通常期限後は店舗都合例外の権限と理由が必要です。メール送信や候補表示だけでは予約は変わりません。
          </p>
          {canUpdate && (
            <Link
              className="block underline"
              href={`/manage/reservations/${reservation.id}/edit?storeException=true`}
            >
              予約変更へ
            </Link>
          )}
          {canCancel && (
            <Link
              className="block underline"
              href={`/manage/reservations/${reservation.id}?storeException=true`}
            >
              予約取消へ
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
