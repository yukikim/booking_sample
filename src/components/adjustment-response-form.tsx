"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "UNCONTACTED" | "AWAITING_CUSTOMER" | "IN_PROGRESS" | "RESOLVED";
export function AdjustmentResponseForm({
  id,
  version,
  current,
  canResolve,
}: {
  id: string;
  version: number;
  current: string;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(
    current === "IMPACT_RESOLVED_PENDING_REVIEW"
      ? "RESOLVED"
      : (current as Status),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const key = useRef<string | null>(null);
  async function submit() {
    if (!note.trim() || busy) return;
    if (
      !window.confirm(
        status === "RESOLVED"
          ? "影響が解消したことを確認し、対応を完了しますか。"
          : "顧客対応状況を保存しますか。",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/manage/adjustments/${id}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestKey: key.current,
          expectedVersion: version,
          status,
          note: note.trim(),
        }),
      });
      if (!response.ok) {
        if (response.status === 409) key.current = null;
        setMessage(
          response.status === 409
            ? "状態が変わりました。再読み込みして確認してください。"
            : "保存できませんでした。同じ内容で再試行してください。",
        );
        return;
      }
      key.current = null;
      setMessage("対応状況を保存しました。");
      router.refresh();
    } catch {
      setMessage("通信結果を確認できません。同じ内容で再試行してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">顧客対応状況</h2>
      <label className="block">
        対応状態
        <select
          className="block rounded border p-2"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as Status);
            key.current = null;
          }}
        >
          {current !== "IMPACT_RESOLVED_PENDING_REVIEW" && (
            <>
              <option value="UNCONTACTED">未連絡</option>
              <option value="AWAITING_CUSTOMER">顧客返信待ち</option>
              <option value="IN_PROGRESS">店舗対応中</option>
            </>
          )}
          {canResolve && (
            <option value="RESOLVED">影響解消を確認して完了</option>
          )}
        </select>
      </label>
      <label className="block">
        対応記録・判断理由（必須）
        <textarea
          className="block w-full rounded border p-2"
          maxLength={1000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            key.current = null;
          }}
        />
      </label>
      <button
        className="rounded border px-3 py-2"
        disabled={busy || !note.trim()}
        onClick={() => void submit()}
      >
        {busy ? "保存中" : "確認して保存"}
      </button>
      {message && (
        <p role="status">
          {message}{" "}
          <a className="underline" href={`/manage/adjustments/${id}`}>
            再読み込み
          </a>
        </p>
      )}
    </section>
  );
}
