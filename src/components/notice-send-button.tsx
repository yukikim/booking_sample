"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NoticeSendButton({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function send() {
    if (!window.confirm("対象の予約と内容を確認しましたか？ 会員への案内メール送信を依頼します。")) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/manage/adjustments/${id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, confirmed: true }) });
      if (!response.ok) { setMessage(response.status === 409 ? "予約や影響状態が変わりました。再読み込みして確認してください。" : "送信依頼を保存できませんでした。"); return; }
      setMessage("送信依頼を保存しました。"); router.refresh();
    } catch { setMessage("送信依頼を保存できませんでした。"); }
    finally { setPending(false); }
  }
  return <div className="space-y-1"><button type="button" onClick={send} disabled={pending} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50">{pending ? "保存中…" : "確認して案内メールを依頼"}</button><p role="status">{message}</p></div>;
}
