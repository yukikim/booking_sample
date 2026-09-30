"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTokyo } from "@/lib/booking/display";

type Item = {
  id: string;
  name: string;
  durationMinutes: number;
  priceYen: number;
};
type Resource = { id: string; name: string; isActive: boolean };
type Member = {
  id: string;
  lastName: string;
  firstName: string;
  email: string;
  phoneNumber: string;
  status: string;
  bookable: boolean;
};
type Slot = {
  startsAt: string;
  treatmentEndsAt: string;
  occupiesUntil: string;
  roomId?: string;
  therapistId?: string;
};
type Availability = {
  totals: { totalDurationMinutes: number; totalPriceYen: number };
  times: Slot[];
  outsideWindow: boolean;
};
export type EditReservation = {
  id: string;
  version: number;
  date: string;
  startsAt: string;
  treatmentId: string;
  optionIds: string[];
  notes: string;
  roomId: string;
  therapistId: string;
  memberName: string;
};

export function ManageReservationForm({
  edit,
  canException,
}: {
  edit?: EditReservation;
  canException: boolean;
}) {
  const [catalog, setCatalog] = useState<{
    treatments: Item[];
    options: Item[];
  } | null>(null);
  const [resources, setResources] = useState<{
    rooms: Resource[];
    therapists: Resource[];
  } | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [treatmentId, setTreatmentId] = useState(edit?.treatmentId ?? "");
  const [optionIds, setOptionIds] = useState(edit?.optionIds ?? []);
  const [date, setDate] = useState(edit?.date ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [assignment, setAssignment] = useState(false);
  const [roomId, setRoomId] = useState(edit?.roomId ?? "");
  const [therapistId, setTherapistId] = useState(edit?.therapistId ?? "");
  const [storeException, setStoreException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState<string | null>(null);
  const searchVersion = useRef(0);
  const memberSearchVersion = useRef(0);
  const requestKey = useRef<string | null>(null);
  const submissionLock = useRef(false);
  const load = useCallback(async () => {
    setLoadingError("");
    try {
      const paths = edit
        ? [
            "/api/catalog",
            "/api/manage/resources/rooms",
            "/api/manage/resources/therapists",
          ]
        : ["/api/catalog"];
      const responses = await Promise.all(
        paths.map((path) => fetch(path, { cache: "no-store" })),
      );
      if (responses.some((response) => !response.ok)) throw new Error();
      const values = await Promise.all(
        responses.map((response) => response.json()),
      );
      setCatalog(values[0] as { treatments: Item[]; options: Item[] });
      if (edit)
        setResources({
          rooms: (values[1] as { items: Resource[] }).items,
          therapists: (values[2] as { items: Resource[] }).items,
        });
    } catch {
      setLoadingError("メニュー・資源を取得できませんでした。");
    }
  }, [edit]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  function invalidate() {
    searchVersion.current++;
    setAvailability(null);
    setSlot(null);
    setConfirming(false);
    setMessage("");
    requestKey.current = null;
  }
  async function searchMembers() {
    if ([...query.trim()].length < 2) {
      setMessage("氏名・メールアドレス・電話番号を2文字以上入力してください。");
      return;
    }
    const version = ++memberSearchVersion.current;
    setSearchingMembers(true);
    setMessage("");
    setMembers([]);
    setMember(null);
    invalidate();
    try {
      const response = await fetch(
        `/api/manage/members?${new URLSearchParams({ query: query.trim() })}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const found = ((await response.json()) as { members: Member[] }).members;
      if (version === memberSearchVersion.current) setMembers(found);
    } catch {
      if (version === memberSearchVersion.current)
        setMessage("会員を検索できませんでした。再試行してください。");
    } finally {
      if (version === memberSearchVersion.current) setSearchingMembers(false);
    }
  }
  const treatment = catalog?.treatments.find((item) => item.id === treatmentId);
  const selectedOptions =
    catalog?.options.filter((item) => optionIds.includes(item.id)) ?? [];
  const quote = treatment
    ? {
        totalDurationMinutes:
          treatment.durationMinutes +
          selectedOptions.reduce((sum, item) => sum + item.durationMinutes, 0),
        totalPriceYen:
          treatment.priceYen +
          selectedOptions.reduce((sum, item) => sum + item.priceYen, 0),
      }
    : null;
  const validQuote =
    quote &&
    quote.totalDurationMinutes <= 1380 &&
    quote.totalPriceYen <= 1_000_000 &&
    selectedOptions.length === optionIds.length;
  async function search() {
    if (
      !date ||
      !treatmentId ||
      !validQuote ||
      (assignment && (!roomId || !therapistId))
    ) {
      setMessage("メニュー・日付・担当を確認してください。");
      return;
    }
    const version = ++searchVersion.current;
    setSearching(true);
    setAvailability(null);
    setSlot(null);
    setConfirming(false);
    setMessage("");
    const params = new URLSearchParams({ date, treatmentId });
    optionIds.forEach((id) => params.append("optionId", id));
    if (edit) {
      params.set("reservationId", edit.id);
      if (assignment) {
        params.set("roomId", roomId);
        params.set("therapistId", therapistId);
      }
      if (storeException) params.set("storeException", "true");
    }
    try {
      const response = await fetch(
        `${edit ? "/api/manage/availability" : "/api/availability"}?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const result = (await response.json()) as Availability;
      if (version === searchVersion.current) setAvailability(result);
    } catch {
      if (version === searchVersion.current)
        setMessage(
          "空き時刻を取得できませんでした。条件を確認して再検索してください。",
        );
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  function prepare() {
    if (
      !slot ||
      !availability ||
      !validQuote ||
      !date ||
      (!edit && !member?.bookable)
    ) {
      setMessage("会員と空き時刻を選択してください。");
      return;
    }
    if (
      [...notes].length > 1000 ||
      notes.includes("\u0000") ||
      (storeException &&
        (!exceptionReason.trim() || [...exceptionReason.trim()].length > 1000))
    ) {
      setMessage("備考または店舗都合の理由を確認してください。");
      return;
    }
    setMessage("");
    setConfirming(true);
    requestKey.current ??= crypto.randomUUID();
  }
  async function submit() {
    if (
      submissionLock.current ||
      !slot ||
      !availability ||
      !quote ||
      !date ||
      (!edit && !member)
    )
      return;
    submissionLock.current = true;
    setSubmitting(true);
    setMessage("");
    const key = requestKey.current ?? crypto.randomUUID();
    requestKey.current = key;
    const body = {
      requestKey: key,
      date,
      startsAt: slot.startsAt,
      treatmentId,
      optionIds,
      quote: availability.totals,
      notes,
      ...(edit
        ? {
            expectedVersion: edit.version,
            ...(assignment ? { roomId, therapistId } : {}),
            ...(storeException
              ? {
                  storeException: true,
                  exceptionReason: exceptionReason.trim(),
                }
              : {}),
          }
        : { memberId: member!.id }),
    };
    try {
      const response = await fetch(
        edit ? `/api/reservations/${edit.id}` : "/api/reservations",
        {
          method: edit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as {
        reservationId?: string;
        error?: string;
      };
      if (response.ok && result.reservationId) {
        setFinished(result.reservationId);
        return;
      }
      if (response.status === 409) {
        requestKey.current = null;
        invalidate();
        setMessage(
          result.error === "DeadlinePassed"
            ? "通常期限を過ぎています。店舗都合の理由と権限を確認してください。"
            : result.error === "VersionConflict"
              ? "別画面で予約が更新されました。詳細を読み直してください。"
              : result.error === "SelectionChanged"
                ? "メニュー・料金が変更されました。内容を読み直してください。"
                : "選んだ枠を確保できませんでした。空きを再検索してください。",
        );
      } else if (response.status === 403) {
        requestKey.current = null;
        setConfirming(false);
        setMessage(
          result.error === "MemberNotBookable"
            ? "会員状態が変わりました。会員を検索し直してください。"
            : "操作権限または会員状態を確認してください。",
        );
      } else if (response.status === 401) {
        requestKey.current = null;
        setConfirming(false);
        setMessage(
          "セッションが切れました。スタッフログインからやり直してください。",
        );
      } else if (response.status === 400) {
        requestKey.current = null;
        setConfirming(false);
        setMessage("入力内容を確認してください。");
      } else
        setMessage(
          "結果を確認できませんでした。同じ内容で再試行してください。",
        );
    } catch {
      setMessage("通信に失敗しました。同じ内容で再試行してください。");
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }
  if (finished)
    return (
      <section className="space-y-3 rounded border p-4">
        <h2 className="text-xl font-semibold">
          {edit ? "予約を変更しました" : "予約を登録しました"}
        </h2>
        <p>予約番号：{finished}</p>
        <Link className="underline" href={`/manage/reservations/${finished}`}>
          予約詳細を見る
        </Link>
      </section>
    );
  return (
    <section className="space-y-6">
      {loadingError && (
        <p role="alert">
          {loadingError}{" "}
          <button
            className="underline"
            type="button"
            onClick={() => void load()}
          >
            再試行
          </button>
        </p>
      )}
      {!catalog && !loadingError && <p>メニューを取得中です…</p>}
      {!edit && (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-xl font-semibold">1. 既存会員を選択</h2>
          <div className="flex gap-2">
            <input
              aria-label="会員検索"
              className="min-w-0 flex-1 rounded border p-2"
              value={query}
              onChange={(event) => {
                memberSearchVersion.current++;
                setSearchingMembers(false);
                setMembers([]);
                setQuery(event.target.value);
                setMember(null);
                invalidate();
              }}
              placeholder="氏名・メールアドレス・電話番号"
            />
            <button
              type="button"
              className="rounded border p-2"
              disabled={searchingMembers}
              onClick={() => void searchMembers()}
            >
              {searchingMembers ? "検索中…" : "検索"}
            </button>
          </div>
          {members.length ? (
            <ul className="space-y-2">
              {members.map((item) => (
                <li key={item.id} className="rounded border p-2">
                  <p>
                    {item.lastName} {item.firstName}／{item.email}／
                    {item.phoneNumber}
                  </p>
                  <p>
                    {item.bookable ? "予約可能" : `予約不可（${item.status}）`}
                  </p>
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    disabled={!item.bookable}
                    onClick={() => {
                      setMember(item);
                      invalidate();
                    }}
                  >
                    この会員を選択
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            query &&
            !searchingMembers && (
              <p>
                候補がない場合は検索語を変えてください。非会員の代理予約はできません。
              </p>
            )
          )}
          {member && (
            <p className="font-semibold">
              選択中：{member.lastName} {member.firstName}
            </p>
          )}
        </section>
      )}
      {edit && <p>対象会員：{edit.memberName}</p>}
      {catalog && (
        <section className="space-y-3 rounded border p-4">
          <h2 className="text-xl font-semibold">
            {edit ? "1" : "2"}. メニューと日時
          </h2>
          <label className="grid gap-1">
            メニュー
            <select
              className="rounded border p-2"
              value={treatmentId}
              onChange={(event) => {
                invalidate();
                setTreatmentId(event.target.value);
              }}
            >
              <option value="">選択してください</option>
              {catalog.treatments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.durationMinutes}分・
                  {item.priceYen.toLocaleString("ja-JP")}円）
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2">
            <legend>オプション</legend>
            {catalog.options.map((item) => (
              <label key={item.id} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={optionIds.includes(item.id)}
                  onChange={(event) => {
                    invalidate();
                    setOptionIds((old) =>
                      event.target.checked
                        ? [...old, item.id]
                        : old.filter((id) => id !== item.id),
                    );
                  }}
                />
                {item.name}（{item.durationMinutes}分・
                {item.priceYen.toLocaleString("ja-JP")}円）
              </label>
            ))}
          </fieldset>
          {quote && (
            <p>
              合計：{quote.totalDurationMinutes}分・
              {quote.totalPriceYen.toLocaleString("ja-JP")}円（税込）
            </p>
          )}
          <label className="grid gap-1">
            予約日
            <input
              type="date"
              className="rounded border p-2"
              value={date}
              onChange={(event) => {
                invalidate();
                setDate(event.target.value);
              }}
            />
          </label>
          <label className="grid gap-1">
            備考
            <textarea
              className="rounded border p-2"
              maxLength={1000}
              value={notes}
              onChange={(event) => {
                invalidate();
                setNotes(event.target.value);
              }}
            />
          </label>
          {edit && resources && (
            <fieldset className="space-y-2">
              <legend>部屋・担当施術者</legend>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={assignment}
                  onChange={(event) => {
                    invalidate();
                    setAssignment(event.target.checked);
                  }}
                />
                割当先を指定する（未指定なら自動割当）
              </label>
              {assignment && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    部屋
                    <select
                      className="rounded border p-2"
                      value={roomId}
                      onChange={(event) => {
                        invalidate();
                        setRoomId(event.target.value);
                      }}
                    >
                      {resources.rooms.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={!item.isActive}
                        >
                          {item.name}
                          {item.isActive ? "" : "（無効）"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    施術者
                    <select
                      className="rounded border p-2"
                      value={therapistId}
                      onChange={(event) => {
                        invalidate();
                        setTherapistId(event.target.value);
                      }}
                    >
                      {resources.therapists.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={!item.isActive}
                        >
                          {item.name}
                          {item.isActive ? "" : "（無効）"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </fieldset>
          )}
          {edit && canException && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={storeException}
                onChange={(event) => {
                  invalidate();
                  setStoreException(event.target.checked);
                }}
              />
              店舗都合の期限後例外を使う
            </label>
          )}
          {storeException && (
            <label className="grid gap-1">
              店舗都合の理由
              <textarea
                className="rounded border p-2"
                maxLength={1000}
                value={exceptionReason}
                onChange={(event) => {
                  setConfirming(false);
                  setExceptionReason(event.target.value);
                }}
              />
            </label>
          )}
          <button
            className="rounded border px-4 py-2"
            type="button"
            disabled={searching || !validQuote || !date}
            onClick={() => void search()}
          >
            {searching ? "検索中…" : "空き時刻を検索"}
          </button>
          {availability && (
            <div className="space-y-2">
              <p>
                {availability.outsideWindow
                  ? "通常の受付期間外です。"
                  : availability.times.length
                    ? "空き時刻を選択してください。"
                    : "空きはありません。"}
              </p>
              <div className="flex flex-wrap gap-2">
                {availability.times.map((time) => (
                  <button
                    key={time.startsAt}
                    type="button"
                    className={`rounded border p-2 ${slot?.startsAt === time.startsAt ? "bg-blue-100" : ""}`}
                    onClick={() => {
                      setSlot(time);
                      setConfirming(false);
                      requestKey.current = null;
                    }}
                  >
                    {formatTokyo(time.startsAt)}〜
                    {formatTokyo(time.treatmentEndsAt)}（占有〜
                    {formatTokyo(time.occupiesUntil)}）
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {message && (
        <p role="alert" className="rounded border p-3">
          {message}
        </p>
      )}
      {slot && !confirming && (
        <button
          className="rounded bg-blue-700 p-3 text-white"
          type="button"
          onClick={prepare}
        >
          内容を確認
        </button>
      )}
      {confirming && slot && (
        <section className="space-y-3 rounded border p-4">
          <h2 className="text-xl font-semibold">確定前の確認</h2>
          <p>
            会員：
            {edit?.memberName ?? `${member?.lastName} ${member?.firstName}`}
          </p>
          <p>
            日時：{formatTokyo(slot.startsAt)}／施術終了：
            {formatTokyo(slot.treatmentEndsAt)}／占有終了：
            {formatTokyo(slot.occupiesUntil)}
          </p>
          <p>
            メニュー：{treatment?.name}／オプション：
            {selectedOptions.length
              ? selectedOptions.map((item) => item.name).join("、")
              : "なし"}
            ／合計：{availability?.totals.totalPriceYen.toLocaleString("ja-JP")}
            円（税込）
          </p>
          <p>
            割当：
            {assignment
              ? `${resources?.rooms.find((item) => item.id === roomId)?.name}／${resources?.therapists.find((item) => item.id === therapistId)?.name}`
              : "保存時に自動割当"}
          </p>
          {storeException && <p>店舗都合の理由：{exceptionReason}</p>}
          <div className="flex gap-3">
            <button
              className="rounded bg-blue-700 p-3 text-white disabled:opacity-50"
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? "処理中…" : edit ? "変更を確定" : "予約を登録"}
            </button>
            <button
              className="rounded border p-3"
              type="button"
              disabled={submitting}
              onClick={() => setConfirming(false)}
            >
              戻る
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
