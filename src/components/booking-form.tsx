"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Item = {
  id: string;
  name: string;
  durationMinutes: number;
  priceYen: number;
};
type Slot = {
  startsAt: string;
  treatmentEndsAt: string;
  occupiesUntil: string;
};
type Totals = { totalDurationMinutes: number; totalPriceYen: number };
type Member = {
  lastName: string;
  firstName: string;
  email: string;
  phoneNumber: string;
};
type Availability = { totals: Totals; times: Slot[]; outsideWindow: boolean };
const yen = (value: number) => `${value.toLocaleString("ja-JP")}円（税込）`;
const time = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export function BookingForm() {
  const [catalog, setCatalog] = useState<{
    treatments: Item[];
    options: Item[];
  } | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [treatmentId, setTreatmentId] = useState("");
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [memberState, setMemberState] = useState<
    "idle" | "loading" | "login" | "blocked" | "error"
  >("idle");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const requestKey = useRef<string | null>(null);
  const searchVersion = useRef(0);
  const draftReady = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("bookingDraft") ?? "null",
      ) as {
        treatmentId?: string;
        optionIds?: string[];
        date?: string;
        notes?: string;
      } | null;
      if (saved)
        queueMicrotask(() => {
          if (typeof saved.treatmentId === "string")
            setTreatmentId(saved.treatmentId);
          if (
            Array.isArray(saved.optionIds) &&
            saved.optionIds.every((id) => typeof id === "string")
          )
            setOptionIds(saved.optionIds);
          if (typeof saved.date === "string") setDate(saved.date);
          if (typeof saved.notes === "string") setNotes(saved.notes);
        });
    } catch {
      /* Ignore damaged browser storage. */
    }
    draftReady.current = true;
  }, []);
  useEffect(() => {
    if (!draftReady.current) return;
    try {
      sessionStorage.setItem(
        "bookingDraft",
        JSON.stringify({ treatmentId, optionIds, date, notes }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  }, [treatmentId, optionIds, date, notes]);
  const loadCatalog = useCallback(async () => {
    setCatalogError(false);
    try {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        treatments: Item[];
        options: Item[];
      };
      setCatalog(data);
    } catch {
      setCatalogError(true);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void loadCatalog());
  }, [loadCatalog]);
  const treatment = catalog?.treatments.find((item) => item.id === treatmentId);
  const selectedOptions =
    catalog?.options.filter((item) => optionIds.includes(item.id)) ?? [];
  const preview = treatment
    ? {
        totalDurationMinutes:
          treatment.durationMinutes +
          selectedOptions.reduce((sum, item) => sum + item.durationMinutes, 0),
        totalPriceYen:
          treatment.priceYen +
          selectedOptions.reduce((sum, item) => sum + item.priceYen, 0),
      }
    : null;
  const validTotal =
    !!preview &&
    preview.totalDurationMinutes <= 1380 &&
    preview.totalPriceYen <= 1_000_000;
  function resetSelection() {
    searchVersion.current++;
    setAvailability(null);
    setSlot(null);
    setSearchError("");
    setConfirming(false);
    setMember(null);
    setMemberState("idle");
    setMessage("");
    requestKey.current = null;
  }
  async function search(selectedDate = date) {
    if (!selectedDate || !treatmentId || !validTotal) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchError("");
    setAvailability(null);
    setSlot(null);
    try {
      const params = new URLSearchParams({ date: selectedDate, treatmentId });
      optionIds.forEach((id) => params.append("optionId", id));
      const response = await fetch(`/api/availability?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as Availability;
      if (version === searchVersion.current) setAvailability(result);
    } catch {
      if (version === searchVersion.current)
        setSearchError("空き時刻を取得できませんでした。再検索してください。");
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  async function prepare() {
    if (!slot || !availability || !date) {
      setMessage("日時を選択してください。");
      return;
    }
    if ([...notes].length > 1000 || notes.includes("\u0000")) {
      setMessage("備考は1,000文字以内で入力してください。");
      return;
    }
    setMemberState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/member/me", { cache: "no-store" });
      if (response.status === 401) {
        setMemberState("login");
        return;
      }
      if (response.status === 403) {
        setMemberState("blocked");
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { member: Member };
      setMember(result.member);
      setMemberState("idle");
      setConfirming(true);
      requestKey.current ??= crypto.randomUUID();
    } catch {
      setMemberState("error");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current || !slot || !availability || !member || !date)
      return;
    submissionLock.current = true;
    setSubmitting(true);
    setMessage("");
    const key = requestKey.current ?? crypto.randomUUID();
    requestKey.current = key;
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: key,
          date,
          startsAt: slot.startsAt,
          treatmentId,
          optionIds,
          quote: {
            totalDurationMinutes: availability.totals.totalDurationMinutes,
            totalPriceYen: availability.totals.totalPriceYen,
          },
          notes,
        }),
      });
      const result = (await response.json()) as {
        reservationId?: string;
        error?: string;
      };
      if (response.ok && result.reservationId) {
        try {
          sessionStorage.removeItem("bookingDraft");
        } catch {
          /* Storage can be disabled. */
        }
        setFinished(result.reservationId);
        return;
      }
      if (response.status === 401) {
        setConfirming(false);
        setMemberState("login");
        requestKey.current = null;
      } else if (response.status === 403) {
        setConfirming(false);
        setMemberState("blocked");
        requestKey.current = null;
      } else if (response.status === 409) {
        setConfirming(false);
        requestKey.current = null;
        setMessage(
          result.error === "SelectionChanged"
            ? "メニュー内容または料金が変更されました。内容を確認し直してください。"
            : "選択した時刻は予約できなくなりました。空きを再検索してください。",
        );
        await loadCatalog();
        await search();
      } else if (response.status === 400) {
        setMessage("入力内容を確認してください。");
        requestKey.current = null;
      } else
        setMessage(
          "予約結果を確認できませんでした。同じ内容で再試行してください。",
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
      <main className="mx-auto max-w-2xl space-y-5 p-6">
        <h1 className="text-2xl font-bold">予約が完了しました</h1>
        <p>
          予約番号：<span className="break-all font-mono">{finished}</span>
        </p>
        <p>
          {treatment?.name}／{slot && time(slot.startsAt)}／
          {availability && yen(availability.totals.totalPriceYen)}
        </p>
        <Link className="text-blue-700 underline" href="/account">
          会員ページへ
        </Link>
      </main>
    );
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Web予約</h1>
      <p>
        メニューと空き時刻はどなたでも確認できます。予約の確定には会員ログインが必要です。
      </p>
      {!catalog && !catalogError && <p role="status">メニューを取得中です…</p>}
      {catalogError && (
        <p role="alert">
          メニューを取得できませんでした。
          <button
            className="text-blue-700 underline"
            onClick={() => void loadCatalog()}
          >
            再試行
          </button>
        </p>
      )}
      {catalog && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">1. メニュー・オプション</h2>
            <label className="block">
              メニュー
              <select
                className="mt-1 w-full rounded border p-3"
                value={treatmentId}
                onChange={(event) => {
                  resetSelection();
                  setTreatmentId(event.target.value);
                }}
              >
                <option value="">選択してください</option>
                {catalog.treatments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.durationMinutes}分・{yen(item.priceYen)}
                    ）
                  </option>
                ))}
              </select>
            </label>
            {catalog.treatments.length === 0 && (
              <p>現在選択できるメニューはありません。</p>
            )}
            <fieldset className="space-y-2">
              <legend>オプション（複数選択可）</legend>
              {catalog.options.map((item) => (
                <label key={item.id} className="flex gap-2 rounded border p-3">
                  <input
                    type="checkbox"
                    checked={optionIds.includes(item.id)}
                    onChange={(event) => {
                      resetSelection();
                      setOptionIds((old) =>
                        event.target.checked
                          ? [...old, item.id]
                          : old.filter((id) => id !== item.id),
                      );
                    }}
                  />
                  <span>
                    {item.name}（{item.durationMinutes}分・{yen(item.priceYen)}
                    ）
                  </span>
                </label>
              ))}
            </fieldset>
            {preview && (
              <p className="font-semibold">
                合計 {preview.totalDurationMinutes}分・
                {yen(preview.totalPriceYen)}
              </p>
            )}
            {preview && !validTotal && (
              <p role="alert">
                合計時間または料金が上限を超えています。選択を変更してください。
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">2. 日付・空き時刻</h2>
            <label className="block">
              予約日
              <input
                className="mt-1 w-full rounded border p-3"
                type="date"
                value={date}
                onChange={(event) => {
                  resetSelection();
                  setDate(event.target.value);
                }}
              />
            </label>
            <button
              type="button"
              disabled={!date || !validTotal || searching}
              className="rounded bg-blue-700 p-3 text-white disabled:opacity-50"
              onClick={() => void search()}
            >
              {searching ? "取得中…" : "空き時刻を検索"}
            </button>
            {searchError && <p role="alert">{searchError}</p>}
            {availability?.outsideWindow && (
              <p role="status">
                この日は予約受付期間外です。予約は30日前から前日の営業終了時刻まで受け付けます。
              </p>
            )}
            {availability &&
              !availability.outsideWindow &&
              availability.times.length === 0 && (
                <p role="status">この日の空き時刻はありません。</p>
              )}
            {availability && availability.times.length > 0 && (
              <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <legend className="mb-2">開始時刻を選択</legend>
                {availability.times.map((item) => (
                  <label key={item.startsAt} className="rounded border p-3">
                    <input
                      type="radio"
                      name="slot"
                      checked={slot?.startsAt === item.startsAt}
                      onChange={() => {
                        setSlot(item);
                        setConfirming(false);
                        setMessage("");
                        requestKey.current = null;
                      }}
                    />{" "}
                    {time(item.startsAt)}
                  </label>
                ))}
              </fieldset>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">3. 予約内容</h2>
            <label className="block">
              備考（任意・1,000文字以内）
              <textarea
                className="mt-1 w-full rounded border p-3"
                rows={3}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setConfirming(false);
                  requestKey.current = null;
                }}
              />
            </label>
            {!confirming && (
              <button
                type="button"
                disabled={!slot || memberState === "loading"}
                className="rounded bg-blue-700 p-3 text-white disabled:opacity-50"
                onClick={() => void prepare()}
              >
                {memberState === "loading"
                  ? "会員情報を確認中…"
                  : "予約内容を確認"}
              </button>
            )}
            {memberState === "login" && (
              <p role="alert">
                ログインの有効期限が切れたか、ログインが必要です。ログイン後に予約画面へ戻れます。
                <Link
                  className="ml-2 text-blue-700 underline"
                  href="/login?next=%2Fbook"
                >
                  ログイン
                </Link>{" "}
                <Link
                  className="text-blue-700 underline"
                  href="/register?next=%2Fbook"
                >
                  会員登録
                </Link>
              </p>
            )}
            {memberState === "blocked" && (
              <p role="alert">
                現在の会員状態では予約できません。アカウント状態を確認してください。
              </p>
            )}
            {memberState === "error" && (
              <p role="alert">
                会員情報を取得できませんでした。もう一度お試しください。
              </p>
            )}
            {confirming && member && slot && availability && (
              <form onSubmit={submit} className="space-y-3 rounded border p-4">
                <h3 className="font-semibold">送信前の確認</h3>
                <p>
                  お名前：{member.lastName} {member.firstName}
                </p>
                <p>メール：{member.email}</p>
                <p>電話番号：{member.phoneNumber}</p>
                <p>メニュー：{treatment?.name}</p>
                <p>
                  オプション：
                  {selectedOptions.length
                    ? selectedOptions.map((item) => item.name).join("、")
                    : "なし"}
                </p>
                <p>
                  日時：{time(slot.startsAt)}（施術終了{" "}
                  {time(slot.treatmentEndsAt)}）
                </p>
                <p>
                  合計：{availability.totals.totalDurationMinutes}分・
                  {yen(availability.totals.totalPriceYen)}
                </p>
                <p>備考：{notes || "なし"}</p>
                <button
                  disabled={submitting}
                  className="rounded bg-blue-700 p-3 text-white disabled:opacity-50"
                >
                  {submitting ? "送信中…" : "この内容で予約する"}
                </button>
              </form>
            )}
            {message && <p role="alert">{message}</p>}
          </section>
        </>
      )}
    </main>
  );
}
