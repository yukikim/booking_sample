"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatTokyo } from "@/lib/booking/display";

export function CancelReservationButton({ id, version, deadline }: { id: string; version: number; deadline: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const locked = useRef(false);
  const requestKey = useRef<string | null>(null);
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true; setPending(true); setMessage("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/reservations/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: requestKey.current, expectedVersion: version }) });
      const result = await response.json() as { status?: string; error?: string };
      if (response.ok && result.status === "CANCELLED") { setConfirming(false); setMessage("予約をキャンセルしました。"); router.refresh(); }
      else if (response.status === 401) { setConfirming(false); setLoginRequired(true); requestKey.current = null; }
      else if (response.status === 409) { setConfirming(false); requestKey.current = null; setMessage(result.error === "DeadlinePassed" ? "キャンセル期限を過ぎました。店舗へご連絡ください。" : "予約状態が変わりました。最新の内容を確認してください。"); router.refresh(); }
      else if (response.status === 403 || response.status === 404) { setConfirming(false); requestKey.current = null; setMessage("この予約をキャンセルできません。"); router.refresh(); }
      else setMessage("結果を確認できませんでした。同じ内容で再試行してください。");
    } catch { setMessage("通信に失敗しました。同じ内容で再試行してください。"); }
    finally { locked.current = false; setPending(false); }
  }
  return <div className="space-y-3">{!confirming && !loginRequired && <button type="button" className="rounded border border-red-700 p-3 text-red-800" onClick={() => { setConfirming(true); setMessage(""); }}>キャンセルする</button>}
    {confirming && <form onSubmit={cancel} className="space-y-3 rounded border p-4"><p>この予約をキャンセルしますか。取り消した予約は元に戻せません。</p><p>受付期限：{formatTokyo(deadline)}まで。送信時に改めて判定します。</p><div className="flex gap-3"><button disabled={pending} className="rounded bg-red-700 p-3 text-white disabled:opacity-50">{pending ? "処理中…" : "キャンセルを確定"}</button><button type="button" disabled={pending} className="rounded border p-3" onClick={() => setConfirming(false)}>戻る</button></div></form>}
    {loginRequired && <p role="alert">ログインの有効期限が切れました。<Link className="text-blue-700 underline" href="/login">ログイン</Link>してください。</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
