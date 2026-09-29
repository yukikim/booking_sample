"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Mode = "register" | "resend" | "confirm" | "reset-request" | "reset";
const settings = {
  register: { title: "会員登録", endpoint: "/api/member/register", button: "確認メールを送る" },
  resend: { title: "確認メールを再送", endpoint: "/api/member/resend", button: "再送を依頼" },
  confirm: { title: "メール確認", endpoint: "/api/member/confirm", button: "パスワードを設定して確認" },
  "reset-request": { title: "パスワード再設定", endpoint: "/api/member/reset-request", button: "再設定メールを依頼" },
  reset: { title: "新しいパスワードを設定", endpoint: "/api/member/reset", button: "パスワードを変更" },
};

export function MemberForm({ mode }: { mode: Mode }) {
  const [token, setToken] = useState<string | null>(null);
  const tokenRead = useRef(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (mode !== "confirm" && mode !== "reset") return;
    if (tokenRead.current) return;
    tokenRead.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    queueMicrotask(() => setToken(value));
    if (value) window.history.replaceState(null, "", window.location.pathname);
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const input = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(settings[mode].endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...(mode === "confirm" || mode === "reset" ? { token } : {}), ...(mode === "register" ? { ageBand: Number(input.ageBand) } : {}) }) });
      const result = await response.json();
      setMessage(response.ok ? mode === "confirm" || mode === "reset" ? "手続きが完了しました。ログインしてください。審査が必要な場合は承認後にログインできます。" : "受付しました。対象のメールアドレスに届く案内をご確認ください。" : response.status === 429 ? "試行回数の上限に達しました。時間をおいて再試行してください。" : result.error === "InvalidOrExpiredLink" ? "リンクが無効または期限切れです。新しいリンクを依頼してください。" : response.status === 400 ? "入力内容を確認してください。" : "現在処理できません。時間をおいて再試行してください。");
    } catch { setMessage("現在処理できません。時間をおいて再試行してください。"); }
    finally { setPending(false); }
  }
  const emailField = mode === "register" || mode === "resend" || mode === "reset-request";
  const passwordField = mode === "register" || mode === "confirm" || mode === "reset";
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="text-2xl font-bold">{settings[mode].title}</h1>
    {(mode === "confirm" || mode === "reset") && token === "" && <p role="alert">リンクが見つかりません。メールのリンクから開いてください。</p>}
    <form onSubmit={submit} className="flex flex-col gap-4">
      {emailField && <label className="flex flex-col gap-1">メールアドレス<input name="email" type="email" required maxLength={254} autoComplete="email" className="rounded border p-2" /></label>}
      {mode === "register" && <>
        <label className="flex flex-col gap-1">姓<input name="lastName" required maxLength={100} autoComplete="family-name" className="rounded border p-2" /></label>
        <label className="flex flex-col gap-1">名<input name="firstName" required maxLength={100} autoComplete="given-name" className="rounded border p-2" /></label>
        <label className="flex flex-col gap-1">電話番号<input name="phoneNumber" required inputMode="numeric" autoComplete="tel" className="rounded border p-2" /></label>
        <label className="flex flex-col gap-1">郵便番号<input name="postalCode" required inputMode="numeric" autoComplete="postal-code" className="rounded border p-2" /></label>
        <label className="flex flex-col gap-1">年代<select name="ageBand" required className="rounded border p-2">{[20,30,40,50,60,70,80].map((age) => <option key={age} value={age}>{age}代</option>)}</select></label>
      </>}
      {passwordField && <label className="flex flex-col gap-1">{mode === "register" ? "仮パスワード" : "新しいパスワード"}<input name="password" type="password" required minLength={15} autoComplete="new-password" className="rounded border p-2" /><span className="text-sm">15〜128文字。メール確認時は改めて設定します。</span></label>}
      <button disabled={pending || ((mode === "confirm" || mode === "reset") && !token)} className="rounded bg-blue-700 p-3 text-white disabled:opacity-50">{pending ? "処理中…" : settings[mode].button}</button>
      <p role="status" aria-live="polite">{message}</p>
    </form>
    <nav className="flex flex-wrap gap-4 text-blue-700 underline"><Link href="/login">ログイン</Link><Link href="/register/resend">確認メール再送</Link><Link href="/forgot-password">パスワード再設定</Link></nav>
  </main>;
}
