"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { StaffPermissionKey } from "@/generated/prisma/enums";
import type { CatalogItem, CatalogKind } from "@/lib/manage/catalog";

type Action = "CREATE" | "UPDATE" | "DISABLE";
function permission(kind: CatalogKind, action: Action): StaffPermissionKey {
  return `${kind === "treatments" ? "TREATMENT" : "OPTION"}_${action}` as StaffPermissionKey;
}
function errorText(status: number) {
  if (status === 400) return "名称・時間・税込料金の入力を確認してください。半角数字のみ使用できます。";
  if (status === 401 || status === 403) return "この操作の権限がありません。ログイン状態を確認してください。";
  if (status === 409) return "ほかの変更が先に保存されました。ページを再読み込みしてください。";
  return "保存できませんでした。時間をおいて再試行してください。";
}
function values(form: HTMLFormElement, kind: CatalogKind) {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  const durationMinutes = String(data.get("durationMinutes") ?? "").trim();
  const priceYen = String(data.get("priceYen") ?? "").trim();
  const minDuration = kind === "treatments" ? 1 : 0;
  if (!name || [...name].length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(name) || !/^[0-9]+$/.test(durationMinutes) || !/^[0-9]+$/.test(priceYen) || Number(durationMinutes) < minDuration || Number(durationMinutes) > 1380 || Number(priceYen) > 1000000) return null;
  return { name, durationMinutes, priceYen };
}

function Editor({ kind, item, canUpdate, canDisable }: { kind: CatalogKind; item: CatalogItem; canUpdate: boolean; canDisable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = kind === "treatments" ? "メニュー" : "オプション";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = values(event.currentTarget, kind);
    if (!data) { setError("名称・時間・税込料金の入力を確認してください。半角数字のみ使用できます。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/catalog/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "update", updatedAt: item.updatedAt, ...data }) });
      if (!response.ok) { setError(errorText(response.status)); return; }
      router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (busy || !window.confirm(`${item.name}を無効化しますか？`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/catalog/${kind}/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "disable", updatedAt: item.updatedAt }) });
      if (!response.ok) { setError(errorText(response.status)); return; }
      router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  return <div className="rounded border p-4">
    {!item.isActive && <p className="font-semibold text-gray-600">無効：{item.name}</p>}
    {item.isActive && <form onSubmit={canUpdate ? save : (event) => event.preventDefault()} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">{label}名<input name="name" required maxLength={200} defaultValue={item.name} readOnly={!canUpdate} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block">時間（分）<input name="durationMinutes" inputMode="numeric" required defaultValue={item.durationMinutes} readOnly={!canUpdate} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block">税込料金（円）<input name="priceYen" inputMode="numeric" required defaultValue={item.priceYen} readOnly={!canUpdate} className="mt-1 block w-full rounded border p-2" /></label>
      </div>
      <div className="flex gap-3">{canUpdate && <button type="submit" disabled={busy} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">変更を保存</button>}{canDisable && <button type="button" onClick={disable} disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50">無効化</button>}</div>
    </form>}
    {!item.isActive && <p>{item.durationMinutes}分・{item.priceYen.toLocaleString("ja-JP")}円（税込）</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </div>;
}

function CreateForm({ kind }: { kind: CatalogKind }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = values(form, kind);
    if (!data) { setError("名称・時間・税込料金の入力を確認してください。半角数字のみ使用できます。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/manage/catalog/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) { setError(errorText(response.status)); return; }
      form.reset(); router.refresh();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">新規追加</h3>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block">名称<input name="name" required maxLength={200} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="block">時間（分）<input name="durationMinutes" inputMode="numeric" required placeholder={kind === "treatments" ? "1〜1380" : "0〜1380"} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="block">税込料金（円）<input name="priceYen" inputMode="numeric" required placeholder="0〜1000000" className="mt-1 block w-full rounded border p-2" /></label>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button type="submit" disabled={busy} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">{busy ? "保存中…" : "追加する"}</button>
  </form>;
}

export function CatalogManager({ kind, items, permissions }: { kind: CatalogKind; items: CatalogItem[]; permissions: StaffPermissionKey[] }) {
  const label = kind === "treatments" ? "施術メニュー" : "オプション";
  const can = (action: Action) => permissions.includes(permission(kind, action));
  return <section className="space-y-4">
    <h2 className="text-xl font-bold">{label}</h2>
    {can("CREATE") && <CreateForm kind={kind} />}
    <div className="space-y-3">{items.map((item) => (can("UPDATE") || can("DISABLE")) && item.isActive
      ? <Editor key={`${item.id}-${item.updatedAt}`} kind={kind} item={item} canUpdate={can("UPDATE")} canDisable={can("DISABLE")} />
      : <div key={item.id} className="rounded border p-4"><p className="font-medium">{item.name}{item.isActive ? "" : "（無効）"}</p><p>{item.durationMinutes}分・{item.priceYen.toLocaleString("ja-JP")}円（税込）</p></div>)}</div>
    {items.length === 0 && <p>登録されていません。</p>}
  </section>;
}
