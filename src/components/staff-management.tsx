"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StaffPermissionKey } from "@/generated/prisma/enums";

const labels: Record<StaffPermissionKey, string> = {
  RESERVATION_CREATE: "予約作成",
  RESERVATION_UPDATE: "予約変更",
  RESERVATION_CANCEL: "予約取消",
  RESERVATION_EXCEPTION: "例外取消",
  RESERVATION_START: "施術開始",
  RESERVATION_COMPLETE: "施術完了",
  TREATMENT_CREATE: "メニュー追加",
  TREATMENT_UPDATE: "メニュー編集",
  TREATMENT_DISABLE: "メニュー無効化",
  OPTION_CREATE: "オプション追加",
  OPTION_UPDATE: "オプション編集",
  OPTION_DISABLE: "オプション無効化",
  ROOM_CREATE: "部屋追加",
  ROOM_UPDATE: "部屋編集",
  ROOM_DISABLE: "部屋無効化",
  THERAPIST_CREATE: "施術者追加",
  THERAPIST_UPDATE: "施術者編集",
  THERAPIST_DISABLE: "施術者無効化",
  BUSINESS_SETTING_MANAGE: "営業設定管理",
  THERAPIST_BREAK_MANAGE: "施術者休憩管理",
  STAFF_CREATE: "スタッフ作成",
  MEMBER_FORCE_WITHDRAW: "会員強制退会",
  MEMBER_DELETE: "会員削除",
  MEMBER_RESTORE: "会員復帰",
  NOTICE_SEND: "変更通知送信",
  NOTICE_UPDATE_RESPONSE: "通知の対応状況更新",
};

export function StaffCreateForm({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/manage/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: data.get("displayName"),
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      if (response.status === 409) {
        setError("このメールアドレスは登録済みです。");
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 400
            ? "入力内容を確認してください。"
            : response.status === 401 || response.status === 403
              ? "作成権限がありません。再度ログインしてください。"
              : "保存できませんでした。時間をおいて再試行してください。",
        );
        return;
      }
      const result = (await response.json()) as { id: string };
      router.push(isAdmin ? `/manage/staff/${result.id}` : "/manage");
      router.refresh();
    } catch {
      setError("通信に失敗しました。再試行してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded border p-5">
      <h2 className="text-xl font-semibold">スタッフを作成</h2>
      <label className="block">
        表示名
        <input
          name="displayName"
          required
          maxLength={100}
          className="mt-1 block w-full rounded border p-2"
        />
      </label>
      <label className="block">
        メールアドレス
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          className="mt-1 block w-full rounded border p-2"
        />
      </label>
      <label className="block">
        初期パスワード（15〜128文字）
        <input
          name="password"
          type="password"
          required
          maxLength={256}
          autoComplete="new-password"
          className="mt-1 block w-full rounded border p-2"
        />
      </label>
      <p className="text-sm">
        作成時の権限は閲覧のみです。権限の付与は管理者が行います。
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? "保存中…" : "作成する"}
      </button>
    </form>
  );
}

export function StaffPermissionForm({
  staffId,
  initial,
}: {
  staffId: string;
  initial: StaffPermissionKey[];
}) {
  const [granted, setGranted] = useState(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(permission: StaffPermissionKey, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/manage/staff/${staffId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission, enabled }),
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "権限を変更できません。再度ログインしてください。"
            : "変更を保存できませんでした。再試行してください。",
        );
        return;
      }
      setGranted((current) => {
        const next = new Set(current);
        if (enabled) next.add(permission);
        else next.delete(permission);
        return next;
      });
    } catch {
      setError("通信に失敗しました。再試行してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">権限の付与・解除</h2>
      <p>
        チェックを変更するとすぐに保存します。解除はログイン中のスタッフの次の操作から反映されます。
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.values(StaffPermissionKey).map((permission) => (
          <label
            key={permission}
            className="flex items-center gap-2 rounded border p-3"
          >
            <input
              type="checkbox"
              checked={granted.has(permission)}
              disabled={busy}
              onChange={(event) =>
                toggle(permission, event.currentTarget.checked)
              }
            />
            {labels[permission]}
          </label>
        ))}
      </div>
    </section>
  );
}
