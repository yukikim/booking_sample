import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTokyo, reservationStatus } from "@/lib/booking/display";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import {
  listStoreReservations,
  parseReservationFilters,
} from "@/lib/manage/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const clock = (value: Date) => formatTokyo(value.toISOString()).slice(-5);
const minute = (value: Date) => {
  const [hour, min] = clock(value).split(":").map(Number);
  return hour * 60 + min;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  let filters;
  try {
    filters = parseReservationFilters(await searchParams);
  } catch {
    return (
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="text-2xl font-bold">予約一覧</h1>
        <p>絞り込み条件を確認してください。</p>
        <Link className="underline" href="/manage/reservations">
          条件をリセット
        </Link>
      </main>
    );
  }
  let data;
  let access;
  try {
    [data, access] = await Promise.all([listStoreReservations(filters), getStoreCapabilities()]);
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return (
      <main className="p-6">
        予約を表示できません。時間をおいて再読み込みしてください。
      </main>
    );
  }
  const query = (view: "list" | "calendar") =>
    `/manage/reservations?${new URLSearchParams({ date: filters.date, roomId: filters.roomId, therapistId: filters.therapistId, status: filters.status, view })}`;
  const active = data.reservations.filter((row) => row.status !== "CANCELLED");
  const shownRooms = filters.roomId
    ? data.rooms.filter((room) => room.id === filters.roomId)
    : data.rooms;
  const calendarRooms = shownRooms.length
    ? shownRooms
    : active
        .map((row) => ({
          id: row.roomId,
          name: row.roomNameSnapshot,
          isActive: false,
        }))
        .filter(
          (row, index, all) =>
            all.findIndex((other) => other.id === row.id) === index,
        );
  const earliest = active.length
    ? Math.max(
        0,
        Math.floor(
          Math.min(...active.map((row) => minute(row.startsAt))) / 60,
        ) * 60,
      )
    : 9 * 60;
  const latest = active.length
    ? Math.min(
        24 * 60,
        Math.ceil(
          Math.max(...active.map((row) => minute(row.occupiesUntil))) / 60,
        ) * 60,
      )
    : 18 * 60;
  const hours = Array.from(
    { length: Math.max(1, (latest - earliest) / 60) },
    (_, index) => earliest / 60 + index,
  );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <Link className="underline" href="/manage">
        ← 店舗画面
      </Link>
      <h1 className="text-2xl font-bold">予約一覧・カレンダー</h1>
      {(access.principal.role === "ADMIN" || access.permissions.includes("RESERVATION_CREATE")) && <Link className="inline-block rounded border p-2 underline" href="/manage/reservations/new">会員の予約を登録</Link>}
      <form
        className="flex flex-wrap items-end gap-3 rounded border p-4"
        action="/manage/reservations"
        method="get"
      >
        <label className="grid gap-1">
          日付
          <input
            className="rounded border p-2"
            name="date"
            type="date"
            defaultValue={filters.date}
            required
          />
        </label>
        <label className="grid gap-1">
          部屋
          <select
            className="rounded border p-2"
            name="roomId"
            defaultValue={filters.roomId}
          >
            <option value="">すべて</option>
            {data.rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
                {room.isActive ? "" : "（無効）"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          施術者
          <select
            className="rounded border p-2"
            name="therapistId"
            defaultValue={filters.therapistId}
          >
            <option value="">すべて</option>
            {data.therapists.map((therapist) => (
              <option key={therapist.id} value={therapist.id}>
                {therapist.name}
                {therapist.isActive ? "" : "（無効）"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          状態
          <select
            className="rounded border p-2"
            name="status"
            defaultValue={filters.status}
          >
            <option value="">すべて</option>
            {["CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(
              (status) => (
                <option key={status} value={status}>
                  {reservationStatus(status)}
                </option>
              ),
            )}
          </select>
        </label>
        <input type="hidden" name="view" value={filters.view} />
        <button className="rounded bg-blue-700 px-4 py-2 text-white">
          絞り込む
        </button>
      </form>
      <nav className="flex gap-4" aria-label="表示切り替え">
        <Link
          className={
            filters.view === "list" ? "font-bold underline" : "underline"
          }
          href={query("list")}
        >
          一覧
        </Link>
        <Link
          className={
            filters.view === "calendar" ? "font-bold underline" : "underline"
          }
          href={query("calendar")}
        >
          カレンダー
        </Link>
      </nav>
      <p>
        {filters.date}：{data.reservations.length}件
      </p>
      {filters.view === "list" ? (
        data.reservations.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] border-collapse text-left">
              <thead>
                <tr>
                  {[
                    "施術時間",
                    "占有終了",
                    "顧客",
                    "メニュー",
                    "部屋",
                    "施術者",
                    "状態",
                    "",
                  ].map((label) => (
                    <th key={label} className="border-b p-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.reservations.map((row) => (
                  <tr key={row.id}>
                    <td className="border-b p-2">
                      {clock(row.startsAt)}〜{clock(row.treatmentEndsAt)}
                    </td>
                    <td className="border-b p-2">{clock(row.occupiesUntil)}</td>
                    <td className="border-b p-2">
                      {row.memberLastNameSnapshot} {row.memberFirstNameSnapshot}
                    </td>
                    <td className="border-b p-2">
                      {row.treatmentNameSnapshot}
                    </td>
                    <td className="border-b p-2">{row.roomNameSnapshot}</td>
                    <td className="border-b p-2">
                      {row.therapistNameSnapshot}
                    </td>
                    <td className="border-b p-2">
                      {reservationStatus(row.status)}
                    </td>
                    <td className="border-b p-2">
                      <Link
                        className="underline"
                        href={`/manage/reservations/${row.id}`}
                      >
                        詳細
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>条件に一致する予約はありません。</p>
        )
      ) : (
        <section className="space-y-3">
          <p>
            青：施術時間／黄：施術後の占有時間。取消済みの予約は枠を占有しません。施術が予定より延びた場合の実占有はこの予定表に反映されません。
          </p>
          {active.length ? (
            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-3">
                <div className="w-14 shrink-0 pt-8">
                  {hours.map((hour) => (
                    <div key={hour} className="h-16 border-t text-xs">
                      {String(hour).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
                {calendarRooms.map((room) => (
                  <div key={room.id} className="w-52 shrink-0">
                    <h2
                      className="h-8 truncate font-semibold"
                      title={room.name}
                    >
                      {room.name}
                    </h2>
                    <div
                      className="relative border-x bg-slate-50"
                      style={{
                        height: hours.length * 64,
                        backgroundImage:
                          "linear-gradient(to bottom, #cbd5e1 1px, transparent 1px)",
                        backgroundSize: "100% 64px",
                      }}
                    >
                      {active
                        .filter((row) => row.roomId === room.id)
                        .map((row) => {
                          const top =
                            ((minute(row.startsAt) - earliest) * 64) / 60;
                          const treatment = Math.max(
                            1,
                            ((minute(row.treatmentEndsAt) -
                              minute(row.startsAt)) *
                              64) /
                              60,
                          );
                          const occupation = Math.max(
                            0,
                            ((minute(row.occupiesUntil) -
                              minute(row.treatmentEndsAt)) *
                              64) /
                              60,
                          );
                          return (
                            <Link
                              key={row.id}
                              href={`/manage/reservations/${row.id}`}
                              className="absolute inset-x-1 z-10 overflow-hidden rounded border border-blue-700 text-xs"
                              style={{
                                top,
                                height: Math.max(28, treatment + occupation),
                              }}
                              title={`${clock(row.startsAt)}〜${clock(row.treatmentEndsAt)} 施術／${clock(row.occupiesUntil)}まで占有`}
                            >
                              <span
                                className="block overflow-hidden bg-blue-100 p-1"
                                style={{ height: treatment }}
                              >
                                {clock(row.startsAt)}{" "}
                                {row.memberLastNameSnapshot}{" "}
                                {row.treatmentNameSnapshot}
                              </span>
                              {occupation > 0 && (
                                <span
                                  className="block bg-amber-100 px-1"
                                  style={{ height: occupation }}
                                >
                                  占有 〜{clock(row.occupiesUntil)}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p>表示する占有枠はありません。</p>
          )}
        </section>
      )}
    </main>
  );
}
