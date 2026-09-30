"use client";

import { useState } from "react";

type Decision = "DIFFERENT_PERSON" | "SAME_PERSON";
export function MemberReviewDecision({
  id,
  reviewVersion,
  memberVersion,
}: {
  id: string;
  reviewVersion: number;
  memberVersion: number;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    if (!decision || !reason.trim() || busy) return;
    setBusy(true);
    setMessage("");
    const requestKey = key ?? crypto.randomUUID();
    setKey(requestKey);
    try {
      const response = await fetch(`/api/manage/members/reviews/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestKey,
          expectedReviewVersion: reviewVersion,
          expectedMemberVersion: memberVersion,
          decision,
          reason: reason.trim(),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) setKey(null);
        setMessage(
          response.status === 409
            ? "審査状態が変わりました。再読み込みして確認してください。"
            : `保存できませんでした：${result.error ?? response.status}`,
        );
        return;
      }
      setDecision(null);
      setKey(null);
      setMessage(
        decision === "DIFFERENT_PERSON"
          ? "別人と確認し、会員を有効化しました。"
          : "同一人物と判断し、申込を却下しました。",
      );
    } catch {
      setMessage("通信結果を確認できません。同じ内容で再試行してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">審査結果を記録</h2>
      <div className="flex gap-2">
        <button
          className="rounded border px-3 py-2"
          onClick={() => {
            setDecision("DIFFERENT_PERSON");
            setKey(null);
          }}
        >
          別人と確認
        </button>
        <button
          className="rounded border px-3 py-2"
          onClick={() => {
            setDecision("SAME_PERSON");
            setKey(null);
          }}
        >
          同一人物として却下
        </button>
      </div>
      {decision && (
        <div className="space-y-2">
          <p>
            {decision === "DIFFERENT_PERSON"
              ? "別人として入会を許可します。"
              : "同一人物として入会を却下します。"}
            対象者と照合履歴を確認してください。
          </p>
          <label className="block">
            判断理由（必須）
            <textarea
              className="block w-full rounded border p-2"
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setKey(null);
              }}
            />
          </label>
          <button
            className="rounded border px-3 py-2"
            disabled={busy || !reason.trim()}
            onClick={submit}
          >
            {busy ? "処理中" : "判断を確定"}
          </button>
        </div>
      )}
      {message && (
        <p role="status">
          {message}{" "}
          <a className="underline" href={`/manage/members/reviews/${id}`}>
            再読み込み
          </a>
        </p>
      )}
    </section>
  );
}
