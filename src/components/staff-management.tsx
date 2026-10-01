"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { StaffPermissionKey } from "@/generated/prisma/enums";
import { emailKey, validPassword } from "@/lib/auth/policy";

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

type StaffField = "displayName" | "email" | "password";
type StaffFieldErrors = Partial<Record<StaffField, string>>;

function validateStaffField(field: StaffField, value: string): string {
  if (field === "displayName") {
    if (!value.trim()) return "表示名を入力してください。";
    if (value.trim().length > 100) return "表示名は100文字以内で入力してください。";
  } else if (field === "email") {
    if (!value.trim()) return "メールアドレスを入力してください。";
    if (!emailKey(value)) return "有効なメールアドレスを入力してください（254文字以内）。";
  } else {
    if (!value) return "初期パスワードを入力してください。";
    if (!validPassword(value)) return "初期パスワードは15〜128文字で入力してください。";
  }
  return "";
}

export function StaffCreateForm({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  function validateField(field: StaffField, value: string) {
    setFieldErrors((current) => ({
      ...current,
      [field]: validateStaffField(field, value),
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors: StaffFieldErrors = {};
    for (const field of ["displayName", "email", "password"] as const) {
      const message = validateStaffField(field, String(data.get(field) ?? ""));
      if (message) errors[field] = message;
    }
    setFieldErrors(errors);
    const firstInvalidField = Object.keys(errors)[0];
    if (firstInvalidField) {
      const input = form.elements.namedItem(firstInvalidField);
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    setBusy(true);
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
        setFieldErrors({ email: "このメールアドレスは登録済みです。" });
        const input = form.elements.namedItem("email");
        if (input instanceof HTMLInputElement) input.focus();
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
    <form noValidate onSubmit={submit} className="space-y-4 rounded border p-5">
      <h2 className="text-xl font-semibold">スタッフを作成</h2>
      <label className="block">
        表示名
        <input
          name="displayName"
          readOnly={busy}
          aria-invalid={!!fieldErrors.displayName}
          aria-describedby={
            fieldErrors.displayName ? "staff-displayName-error" : undefined
          }
          onBlur={(event) => validateField("displayName", event.currentTarget.value)}
          onChange={(event) => {
            if (fieldErrors.displayName) {
              validateField("displayName", event.currentTarget.value);
            }
          }}
          required
          maxLength={100}
          className="mt-1 block w-full rounded border p-2"
        />
        {fieldErrors.displayName && (
          <span
            id="staff-displayName-error"
            role="alert"
            className="mt-1 block text-sm text-red-700"
          >
            {fieldErrors.displayName}
          </span>
        )}
      </label>
      <label className="block">
        メールアドレス
        <input
          name="email"
          readOnly={busy}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={
            fieldErrors.email ? "staff-email-error" : undefined
          }
          onBlur={(event) => validateField("email", event.currentTarget.value)}
          onChange={(event) => {
            if (fieldErrors.email) {
              validateField("email", event.currentTarget.value);
            }
          }}
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          className="mt-1 block w-full rounded border p-2"
        />
        {fieldErrors.email && (
          <span
            id="staff-email-error"
            role="alert"
            className="mt-1 block text-sm text-red-700"
          >
            {fieldErrors.email}
          </span>
        )}
      </label>
      <label className="block">
        初期パスワード（15〜128文字）
        <input
          name="password"
          readOnly={busy}
          aria-invalid={!!fieldErrors.password}
          aria-describedby={
            fieldErrors.password ? "staff-password-error" : undefined
          }
          onBlur={(event) => validateField("password", event.currentTarget.value)}
          onChange={(event) => {
            if (fieldErrors.password) {
              validateField("password", event.currentTarget.value);
            }
          }}
          type="password"
          required
          maxLength={256}
          autoComplete="new-password"
          className="mt-1 block w-full rounded border p-2"
        />
        {fieldErrors.password && (
          <span
            id="staff-password-error"
            role="alert"
            className="mt-1 block text-sm text-red-700"
          >
            {fieldErrors.password}
          </span>
        )}
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
              readOnly={busy}
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
