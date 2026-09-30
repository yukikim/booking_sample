import Link from "next/link";
import { redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/auth/member";
import { listMemberReservations } from "@/lib/booking/member-reservations";
import { formatTokyo, reservationStatus } from "@/lib/booking/display";
import { LogoutButton } from "@/components/auth/login-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let reservations;
  try { reservations = await listMemberReservations(); }
  catch (error) {
    if (error instanceof MemberAccessError && error.status === 401) redirect("/login");
    return <main className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-bold">会員ページを表示できません</h1><p>{error instanceof MemberAccessError && error.status === 403 ? "アカウント状態を確認してください。" : "現在予約を取得できません。時間をおいて再試行してください。"}</p></main>;
  }
  return <main className="mx-auto max-w-2xl space-y-6 p-6"><h1 className="text-2xl font-bold">マイページ</h1><Link className="text-blue-700 underline" href="/book">新しく予約する</Link>
    <section className="space-y-3"><h2 className="text-xl font-semibold">予約一覧</h2>{reservations.length === 0 && <p>予約はありません。</p>}
      <ul className="space-y-3">{reservations.map(reservation => <li key={reservation.id} className="rounded border p-4"><p className="font-semibold">{formatTokyo(reservation.startsAt)}　{reservation.treatmentNameSnapshot}</p><p>{reservationStatus(reservation.status)}／{reservation.totalDurationMinutes}分／{reservation.totalPriceYen.toLocaleString("ja-JP")}円（税込）</p><Link className="text-blue-700 underline" href={`/account/reservations/${reservation.id}`}>詳細を見る</Link></li>)}</ul>
    </section><LogoutButton target="/login" />
  </main>;
}
