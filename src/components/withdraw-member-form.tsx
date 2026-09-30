"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { formatTokyo } from "@/lib/booking/display";

type Preview = {
  expectedVersion: number;
  reviewToken: string;
  confirmed: { id: string; startsAt: string; treatmentName: string }[];
  inProgressCount: number;
  completedCount: number;
  cancelledCount: number;
};
type Result = { status: string; cancelledCount: number };
const reasons = ["利用予定がなくなった", "サービスが合わなかった", "その他"] as const;

export function WithdrawMemberForm({ initialPreview }: { initialPreview: Preview }) {
  const [preview, setPreview] = useState(initialPreview);
  const [reasonChoice, setReasonChoice] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const locked = useRef(false);
  const requestKey = useRef<string | null>(null);
  const reason = reasonChoice === "その他" ? customReason.trim() : reasonChoice;
  const validReason = !!reason && [...reason].length <= 1000 && !reason.includes("\u0000");

  async function refreshPreview() {
    const response = await fetch("/api/member/withdraw/preview", { cache: "no-store" });
    if (response.status === 401) { setLoginRequired(true); throw new Error("login"); }
    if (response.status === 403) throw new Error("account");
    if (!response.ok) throw new Error("fetch");
    const data = await response.json() as { preview: Preview };
    setPreview(data.preview);
    return data.preview;
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!validReason) { setMessage("退会理由を選択するか、1,000文字以内で入力してください。"); return; }
    setPending(true);
    try {
      await refreshPreview();
      requestKey.current = crypto.randomUUID();
      setConfirming(true);
    } catch (error) {
      setMessage(error instanceof Error && error.message === "login" ? "ログインの有効期限が切れました。" : error instanceof Error && error.message === "account" ? "現在の会員状態では退会を受け付けられません。" : "対象予約を取得できませんでした。もう一度お試しください。");
    } finally { setPending(false); }
  }
  async function submit() {
    if (locked.current || !confirming || !validReason) return;
    locked.current = true; setPending(true); setMessage("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/member/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: requestKey.current, expectedVersion: preview.expectedVersion, reviewToken: preview.reviewToken, reason }) });
      const data = await response.json() as Result & { error?: string };
      if (response.ok && data.status === "WITHDRAWN") { setResult(data); return; }
      if (response.status === 401) { setConfirming(false); setLoginRequired(true); setMessage("ログインの有効期限が切れました。手続き結果が不明な場合は店舗へ確認してください。"); }
      else if (response.status === 409) {
        requestKey.current = null; setConfirming(false);
        setMessage(data.error === "ReservationSetChanged" ? "対象予約が変わりました。最新の予約を確認してから、もう一度お手続きください。" : "会員状態が変わりました。内容を確認し直してください。");
        try { await refreshPreview(); } catch { /* Keep the conflict message. */ }
      } else if (response.status === 400) { requestKey.current = null; setConfirming(false); setMessage("退会理由を確認してください。"); }
      else setMessage("送信結果を確認できません。再試行しても結果が分からない場合は店舗へお問い合わせください。");
    } catch { setMessage("通信が途切れたため結果を確認できません。同じ内容で再試行するか、店舗へお問い合わせください。"); }
    finally { locked.current = false; setPending(false); }
  }
  if (result) return <main className="mx-auto max-w-2xl space-y-5 p-6"><h1 className="text-2xl font-bold">退会が完了しました</h1><p>確定予約を{result.cancelledCount}件キャンセルしました。会員ログインと新規予約はできなくなりました。</p><p>施術中の予約、会員情報、完了・取消済みの予約履歴は保持されます。アカウントの復旧をご希望の場合は店舗へご連絡ください。</p><Link className="text-blue-700 underline" href="/">トップページへ</Link></main>;
  return <main className="mx-auto max-w-2xl space-y-6 p-6"><Link className="text-blue-700 underline" href="/account">← マイページへ</Link><h1 className="text-2xl font-bold">退会手続き</h1>
    {!confirming ? <form onSubmit={review} className="space-y-4"><fieldset className="space-y-2"><legend className="font-semibold">退会理由（必須）</legend>{reasons.map(choice => <label key={choice} className="flex gap-2 rounded border p-3"><input type="radio" name="reason" checked={reasonChoice === choice} onChange={() => setReasonChoice(choice)} />{choice}</label>)}</fieldset>{reasonChoice === "その他" && <label className="block">理由を入力（1,000文字以内）<textarea className="mt-1 w-full rounded border p-3" rows={4} value={customReason} onChange={event => setCustomReason(event.target.value)} /></label>}
      <p>退会すると確定予約は通常のキャンセル期限を過ぎていても取り消され、枠が解放されます。施術中の予約は維持し、会員情報と予約履歴は保持します。退会後はログイン・新規予約ができません。</p><button disabled={pending} className="rounded bg-blue-700 p-3 text-white disabled:opacity-50">{pending ? "確認中…" : "対象予約と退会内容を確認"}</button></form> : <section className="space-y-4 rounded border p-4"><h2 className="text-xl font-semibold">送信前の確認</h2><p>退会理由：{reason}</p><h3 className="font-semibold">自動キャンセルする確定予約：{preview.confirmed.length}件</h3>{preview.confirmed.length ? <ul className="list-disc space-y-1 pl-6">{preview.confirmed.map(item => <li key={item.id}>{formatTokyo(item.startsAt)}　{item.treatmentName}（{item.id}）</li>)}</ul> : <p>対象の確定予約はありません。</p>}<p>施術中：{preview.inProgressCount}件は維持します。完了済み：{preview.completedCount}件、取消済み：{preview.cancelledCount}件の履歴も保持します。</p><p>確認後に別の予約が登録・変更された場合は、最新の対象を確認し直していただきます。</p><p>退会すると全セッションが失効し、会員としてのログインと新規予約はできなくなります。</p><div className="flex flex-wrap gap-3"><button type="button" disabled={pending} className="rounded bg-red-700 p-3 text-white disabled:opacity-50" onClick={() => void submit()}>{pending ? "処理中…" : "退会を確定"}</button><button type="button" disabled={pending} className="rounded border p-3" onClick={() => { setConfirming(false); requestKey.current = null; }}>戻る</button></div></section>}
    {loginRequired && <p role="alert"><Link className="text-blue-700 underline" href="/login">ログイン</Link>してから手続きをやり直してください。</p>}{message && <p role="alert">{message}</p>}
  </main>;
}
