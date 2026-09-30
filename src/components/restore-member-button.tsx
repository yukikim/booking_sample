"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RestoreMemberButton({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function begin() {
    if (
      !reason.trim() ||
      !window.confirm("既存会員の復旧確認メールを送信しますか？")
    )
      return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/manage/members/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version, reason }),
      });
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? "状態が変わったか、メールの依頼間隔に達していません。再確認してください。"
            : "復旧手続きを開始できませんでした。",
        );
        return;
      }
      setMessage("復旧確認メールの送信依頼を保存しました。");
      router.refresh();
    } catch {
      setMessage("復旧手続きを開始できませんでした。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <label className="block">
        復旧理由
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          className="ml-2 rounded border p-2"
        />
      </label>
      <button
        type="button"
        onClick={begin}
        disabled={pending || !reason.trim()}
        className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50"
      >
        復旧確認メールを依頼
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
