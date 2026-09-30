"use client";

import { useState } from "react";

type Action = "force" | "delete" | "restore";
export function ManageMemberActions({
  id,
  version,
  status,
  isDeleted,
  canForce,
  canDelete,
  canRestore,
  reviewToken,
  confirmedCount,
}: {
  id: string;
  version: number;
  status: string;
  isDeleted: boolean;
  canForce: boolean;
  canDelete: boolean;
  canRestore: boolean;
  reviewToken: string;
  confirmedCount: number;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const withdrawn = status === "WITHDRAWN" && isDeleted;
  async function submit() {
    if (!action || busy) return;
    setBusy(true);
    setMessage("");
    const key = requestKey ?? crypto.randomUUID();
    if (action !== "restore") setRequestKey(key);
    try {
      const response = await fetch(
        `/api/manage/members/${id}/${action === "restore" ? "restore" : "withdraw"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            action === "restore"
              ? { expectedVersion: version, reason: reason.trim() }
              : {
                  operation: action,
                  requestKey: key,
                  expectedVersion: version,
                  reason: reason.trim() || null,
                  reviewToken,
                },
          ),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        cancelledCount?: number;
      };
      if (!response.ok) {
        if (response.status === 409) {
          setRequestKey(null);
          setMessage(
            `状態が変わりました（${result.error ?? "Conflict"}）。ページを再読み込みして内容を確認してください。`,
          );
        } else
          setMessage(
            `保存できませんでした：${result.error ?? response.status}。通信結果が不明な場合は同じ内容で再試行できます。`,
          );
        return;
      }
      setRequestKey(null);
      setAction(null);
      setMessage(
        action === "restore"
          ? "復旧確認メールを発行しました。本人の確認と新しいパスワード設定後に有効になります。"
          : `${action === "force" ? "強制退会" : "論理削除"}を完了しました。確定予約${result.cancelledCount ?? 0}件を取消しました。`,
      );
    } catch {
      setMessage(
        action === "restore"
          ? "通信結果を確認できません。会員状態を再読み込みしてから復旧申請の要否を確認してください。"
          : "通信結果を確認できません。同じ内容で再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  const choose = (value: Action) => {
    setAction(value);
    setReason("");
    setRequestKey(null);
    setMessage("");
  };
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">会員状態の操作</h2>
      <div className="flex flex-wrap gap-2">
        {!withdrawn && canForce && (
          <button
            className="rounded border px-3 py-2"
            onClick={() => choose("force")}
          >
            強制退会
          </button>
        )}
        {!withdrawn && canDelete && (
          <button
            className="rounded border px-3 py-2"
            onClick={() => choose("delete")}
          >
            論理削除
          </button>
        )}
        {withdrawn && canRestore && (
          <button
            className="rounded border px-3 py-2"
            onClick={() => choose("restore")}
          >
            復旧を申請
          </button>
        )}
      </div>
      {action && (
        <div className="space-y-3 rounded border p-3">
          <p className="font-semibold">
            {action === "restore"
              ? "復旧確認"
              : action === "force"
                ? "強制退会の確認"
                : "論理削除の確認"}
          </p>
          <p>
            {action === "restore"
              ? "本人へ復旧確認メールを送り、新しいパスワードの設定後に有効化します。取消済み予約は復活しません。"
              : `現在の確定予約${confirmedCount}件を取消し、枠を解放します。開始済み・完了済み予約と履歴は残ります。`}
          </p>
          <label className="block">
            理由{action === "restore" ? "（必須）" : "（任意）"}
            <textarea
              className="block w-full rounded border p-2"
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setRequestKey(null);
              }}
            />
          </label>
          <div className="flex gap-2">
            <button
              className="rounded border px-3 py-2"
              disabled={busy || (action === "restore" && !reason.trim())}
              onClick={submit}
            >
              {busy ? "処理中" : "内容を確認して実行"}
            </button>
            <button
              className="underline"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status">
          {message}{" "}
          <a className="underline" href={`/manage/members/${id}`}>
            再読み込み
          </a>
        </p>
      )}
    </section>
  );
}
