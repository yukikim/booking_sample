"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { StaffPermissionKey } from "@/generated/prisma/enums";
import type { ResourceItem, ResourceKind } from "@/lib/manage/resources";

type Action = "CREATE" | "UPDATE" | "DISABLE";
function permission(kind: ResourceKind, action: Action): StaffPermissionKey {
  return `${kind === "rooms" ? "ROOM" : "THERAPIST"}_${action}` as StaffPermissionKey;
}
function validName(value: FormDataEntryValue | null) {
  const name = typeof value === "string" ? value.trim() : "";
  return name && [...name].length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name) ? name : null;
}
async function errorText(response: Response) {
  if (response.status === 400) return "名称を確認してください。100文字以内で入力してください。";
  if (response.status === 401 || response.status === 403) return "この操作の権限がありません。ログイン状態を確認してください。";
  if (response.status === 409) {
    const body = await response.json() as { error?: string };
    return body.error === "ReviewRequired" ? "予約や資源が変わりました。影響をもう一度確認してください。" : "ほかの変更が先に保存されました。ページを再読み込みしてください。";
  }
  return "保存できませんでした。時間をおいて再試行してください。";
}

function CreateForm({ kind }: { kind: ResourceKind }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const name = validName(new FormData(form).get("name"));
    if (!name) { setError("名称を確認してください。100文字以内で入力してください。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/resources/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) { setError(await errorText(response)); return; }
      form.reset(); router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">新規追加</h3>
    <label className="block">名称<input name="name" required maxLength={200} className="mt-1 block w-full rounded border p-2" /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button type="submit" disabled={busy} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">{busy ? "保存中…" : "追加する"}</button>
  </form>;
}

function Editor({ kind, item, canUpdate, canDisable }: { kind: ResourceKind; item: ResourceItem; canUpdate: boolean; canDisable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [disableReview, setDisableReview] = useState<{ affected: { reservationId: string; businessDate: string }[]; reviewToken: string } | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canUpdate) return;
    const name = validName(new FormData(event.currentTarget).get("name"));
    if (!name) { setError("名称を確認してください。100文字以内で入力してください。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/resources/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "update", updatedAt: item.updatedAt, name }) });
      if (!response.ok) { setError(await errorText(response)); return; }
      router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (busy || !canDisable) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/resources/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "preview-disable", updatedAt: item.updatedAt }) });
      if (!response.ok) { setError(await errorText(response)); return; }
      setDisableReview(await response.json());
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  async function confirmDisable() {
    if (busy || !disableReview) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/resources/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "disable", updatedAt: item.updatedAt, reviewToken: disableReview.reviewToken }) });
      if (!response.ok) { setError(await errorText(response)); setDisableReview(null); return; }
      router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  return <div className="rounded border p-4">
    <form onSubmit={save} className="space-y-3">
      <label className="block">名称<input name="name" required maxLength={200} defaultValue={item.name} readOnly={!canUpdate} className="mt-1 block w-full rounded border p-2" /></label>
      <div className="flex gap-3">{canUpdate && <button type="submit" disabled={busy} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">変更を保存</button>}{canDisable && <button type="button" onClick={disable} disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50">無効化</button>}</div>
    </form>
    {disableReview && <section className="mt-3 space-y-2 rounded border-2 border-amber-500 p-3"><p>{item.name}を無効化すると、未終了予約{disableReview.affected.length}件が要調整になります。予約と占有枠は維持し、メールは自動送信しません。</p>{disableReview.affected.length > 0 && <p className="text-sm">対象日：{disableReview.affected.map((row) => row.businessDate).join("、")}</p>}<button type="button" onClick={confirmDisable} disabled={busy} className="rounded bg-amber-700 px-3 py-2 text-white">確認して無効化</button></section>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </div>;
}

export function ResourceManager({ kind, items, permissions }: { kind: ResourceKind; items: ResourceItem[]; permissions: StaffPermissionKey[] }) {
  const label = kind === "rooms" ? "部屋" : "施術者";
  const can = (action: Action) => permissions.includes(permission(kind, action));
  const activeCount = items.filter((item) => item.isActive).length;
  return <section className="space-y-4">
    <h2 className="text-xl font-bold">{label}</h2>
    <p>有効な{label}：{activeCount}件</p>
    {can("CREATE") && <CreateForm kind={kind} />}
    <div className="space-y-3">{items.map((item) => item.isActive && (can("UPDATE") || can("DISABLE"))
      ? <Editor key={`${item.id}-${item.updatedAt}`} kind={kind} item={item} canUpdate={can("UPDATE")} canDisable={can("DISABLE")} />
      : <div key={item.id} className="rounded border p-4">{item.name}{item.isActive ? "" : "（無効）"}</div>)}</div>
    {items.length === 0 && <p>登録されていません。</p>}
  </section>;
}
