"use client";

import { Button } from "@/components/ui/button";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm({ role }: { role: "admin" | "staff" | "member" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const target =
        role === "member"
          ? searchParams.get("next") === "/book"
            ? "/book"
            : "/account"
          : "/manage";
      const result = await signIn(role, {
        email: form.get("email"),
        password: form.get("password"),
        redirect: false,
        redirectTo: target,
      });
      if (result?.ok && !result.error) {
        router.replace(target);
        router.refresh();
        return;
      }
      setMessage(
        result?.code === "rate_limited"
          ? "試行回数が上限に達しました。15分ほど待って再試行してください。"
          : result?.code === "already_signed_in"
            ? "別のアカウントを使う場合は先にログアウトしてください。"
            : result?.status === 503
              ? "現在ログインできません。時間をおいて再試行してください。"
              : "メールアドレスまたはパスワードを確認してください。",
      );
    } catch {
      setMessage("現在ログインできません。時間をおいて再試行してください。");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        メールアドレス
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          className="rounded border p-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        パスワード
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border p-2"
        />
      </label>
      <Button disabled={pending}>
        {pending ? "確認中…" : "ログイン"}
      </Button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
export function LogoutButton({ target = "/staff/login", className = "rounded border p-3", onSuccess }: { target?: string; className?: string; onSuccess?: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setMessage("");
    try {
      // Use the response status: Auth.js's client signOut does not check response.ok.
      const csrf = await fetch("/api/auth/csrf");
      if (!csrf.ok) throw new Error();
      const { csrfToken } = await csrf.json();
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({ csrfToken, callbackUrl: target }),
      });
      if (!response.ok) throw new Error();
      onSuccess?.();
      router.replace(target);
      router.refresh();
    } catch {
      setMessage("ログアウトを完了できませんでした。再試行してください。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        onClick={logout}
        disabled={pending}
        className={className}
      >
        {pending ? "処理中…" : "ログアウト"}
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
