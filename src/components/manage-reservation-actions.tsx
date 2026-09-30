"use client";

import { useRef, useState } from "react";

type Action = "cancel" | "start" | "complete";
type Props = {
  id: string;
  version: number;
  status: string;
  canCancel: boolean;
  canStart: boolean;
  canComplete: boolean;
  canException: boolean;
};

export function ManageReservationActions({
  id,
  version,
  status,
  canCancel,
  canStart,
  canComplete,
  canException,
}: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [storeException, setStoreException] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  function choose(next: Action) {
    setAction(next);
    setMessage("");
    setDone(false);
    key.current = null;
  }
  async function submit() {
    if (!action || lock.current) return;
    if (
      action === "cancel" &&
      storeException &&
      (!reason.trim() || [...reason.trim()].length > 1000)
    ) {
      setMessage("店舗都合の理由を1,000文字以内で入力してください。");
      return;
    }
    lock.current = true;
    setPending(true);
    setMessage("");
    key.current ??= crypto.randomUUID();
    const body =
      action === "cancel"
        ? {
            requestKey: key.current,
            expectedVersion: version,
            ...(storeException
              ? { storeException: true, exceptionReason: reason.trim() }
              : { reason: reason.trim() || null }),
          }
        : { requestKey: key.current, expectedVersion: version };
    try {
      const response = await fetch(
        action === "cancel"
          ? `/api/reservations/${id}`
          : `/api/manage/reservations/${id}/progress?step=${action}`,
        {
          method: action === "cancel" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (response.ok) {
        setDone(true);
        setMessage(
          action === "cancel"
            ? "予約を取り消しました。枠は解放されました。"
            : action === "start"
              ? "施術開始を記録しました。"
              : "施術完了を記録しました。占有枠は保持されています。",
        );
        return;
      }
      if (response.status === 409) {
        key.current = null;
        setAction(null);
        setMessage(
          result.error === "DeadlinePassed"
            ? "通常の取消期限を過ぎています。店舗都合の例外権限と理由を確認してください。"
            : "別画面で予約が変更されました。詳細を読み直してください。",
        );
      } else if (response.status === 401 || response.status === 403) {
        key.current = null;
        setAction(null);
        setMessage("セッションまたは操作権限を確認してください。");
      } else if (response.status === 400) {
        key.current = null;
        setMessage("入力内容を確認してください。");
      } else
        setMessage(
          "結果を確認できませんでした。同じ内容で再試行してください。",
        );
    } catch {
      setMessage("通信に失敗しました。同じ内容で再試行してください。");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (!canCancel && !canStart && !canComplete) return null;
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-xl font-semibold">店舗操作</h2>
      {!done && (
        <div className="flex flex-wrap gap-3">
          {status === "CONFIRMED" && canCancel && (
            <button
              type="button"
              className="rounded border p-2"
              onClick={() => choose("cancel")}
            >
              予約を取り消す
            </button>
          )}
          {status === "CONFIRMED" && canStart && (
            <button
              type="button"
              className="rounded border p-2"
              onClick={() => choose("start")}
            >
              施術を開始
            </button>
          )}
          {status === "IN_PROGRESS" && canComplete && (
            <button
              type="button"
              className="rounded border p-2"
              onClick={() => choose("complete")}
            >
              施術を完了
            </button>
          )}
        </div>
      )}
      {action && !done && (
        <div className="space-y-3">
          <p>
            {action === "cancel"
              ? "この予約を取り消しますか。元には戻せません。"
              : action === "start"
                ? "施術開始時刻を記録しますか。"
                : "施術完了時刻を記録しますか。早期完了でも予定占有枠は保持します。"}
          </p>
          {action === "cancel" && (
            <>
              <label className="grid gap-1">
                理由（通常取消は任意）
                <textarea
                  className="rounded border p-2"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => {
                    key.current = null;
                    setReason(event.target.value);
                  }}
                />
              </label>
              {canException && (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={storeException}
                    onChange={(event) => {
                      key.current = null;
                      setStoreException(event.target.checked);
                    }}
                  />
                  店舗都合の期限後例外を使う（理由必須）
                </label>
              )}
            </>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              className="rounded bg-blue-700 p-2 text-white disabled:opacity-50"
              onClick={() => void submit()}
            >
              {pending ? "処理中…" : "確定"}
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded border p-2"
              onClick={() => setAction(null)}
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {done && (
        <button
          type="button"
          className="underline"
          onClick={() => window.location.reload()}
        >
          最新の予約詳細を表示
        </button>
      )}
    </section>
  );
}
