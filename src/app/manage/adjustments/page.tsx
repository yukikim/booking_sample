import Link from "next/link";
import { redirect } from "next/navigation";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";
import { NoticeSendButton } from "@/components/notice-send-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reasons: Record<string, string> = {
  BUSINESS_CLOSED: "休業",
  OUTSIDE_BUSINESS_HOURS: "営業時間外",
  BREAK_UNSET: "施術者の休憩未設定",
  OVERLAPS_BREAK: "施術者の休憩と重複",
  RESOURCE_UNAVAILABLE: "部屋・施術者が無効",
};

export default async function Page() {
  let access;
  try {
    access = await getStoreCapabilities();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return <main className="p-8">要調整の予約を表示できません。</main>;
  }
  const notices = await getPrisma().reservationChangeNotice.findMany({
    where: { resolvedAt: null, responseStatus: { not: "RESOLVED" } },
    orderBy: [{ reservation: { startsAt: "asc" } }, { createdAt: "asc" }],
    include: {
      reservation: {
        select: {
          id: true,
          startsAt: true,
          status: true,
          roomNameSnapshot: true,
          therapistNameSnapshot: true,
        },
      },
      changeAudit: { select: { action: true } },
      deliveries: {
        where: { kind: "RESERVATION_CHANGE" },
        select: { status: true },
      },
    },
  });
  const dateTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const soon = (await getPrisma().$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now.getTime() + 48 * 60 * 60_000;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">要調整の予約</h1>
      <p>
        設定変更による影響を表示します。予約・占有枠は保持されています。顧客案内はスタッフ確認後の別操作で行います。
      </p>
      {notices.length === 0 ? (
        <p>未解決の影響はありません。</p>
      ) : (
        <ul className="space-y-3">
          {notices.map((notice) => (
            <li key={notice.id} className={`rounded border p-4 ${notice.reservation.startsAt.getTime() <= soon && notice.responseStatus !== "IMPACT_RESOLVED_PENDING_REVIEW" ? "border-red-600 bg-red-50" : ""}`}>
              <p className="font-bold">
                {dateTime.format(notice.reservation.startsAt)}　予約{" "}
                {notice.reservation.id.slice(0, 8)}
              </p>
              <p>
                部屋：{notice.reservation.roomNameSnapshot}／施術者：
                {notice.reservation.therapistNameSnapshot}
              </p>
              <p>
                影響：{reasons[notice.reason] ?? notice.reason}／状態：
                {notice.responseStatus === "IMPACT_RESOLVED_PENDING_REVIEW"
                  ? "影響解消・店舗確認待ち"
                  : "要調整"}
              </p>
              <p className="text-sm">
                変更：{notice.changeAudit.action}／予約状態：
                {notice.reservation.status}
              </p>
              {notice.reservation.startsAt.getTime() <= soon && notice.responseStatus !== "IMPACT_RESOLVED_PENDING_REVIEW" && <p className="font-semibold text-red-800">来店日時が迫っています。店舗で対応を確認してください。</p>}
              <p>配信状態：{notice.deliveries[0]?.status ?? "未依頼"}／顧客対応状態：{notice.responseStatus}</p>
              <Link className="block underline" href={`/manage/adjustments/${notice.id}`}>候補と対応の詳細</Link>
              {notice.deliveries.length ? (
                <p>メール送信状態：{notice.deliveries[0].status}</p>
              ) : notice.responseStatus !== "IMPACT_RESOLVED_PENDING_REVIEW" &&
                (access.principal.role === "ADMIN" ||
                  access.permissions.includes("NOTICE_SEND")) ? (
                <NoticeSendButton id={notice.id} version={notice.version} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link href="/manage" className="underline">
        店舗画面へ戻る
      </Link>
    </main>
  );
}
