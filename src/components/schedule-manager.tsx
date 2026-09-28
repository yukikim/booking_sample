"use client";

import { useState, type FormEvent } from "react";
import type { StaffPermissionKey } from "@/generated/prisma/enums";
import type { listManagedSchedules } from "@/lib/schedules/manage";

type ScheduleData = Awaited<ReturnType<typeof listManagedSchedules>>;
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/manage/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        if (response.status === 400) setError("日付・時刻・理由を確認してください。時刻は正時、休憩は1時間です。");
        else if (response.status === 401 || response.status === 403) setError("この設定を変更する権限がありません。ログイン状態を確認してください。");
        else if (response.status === 409) {
          const result = await response.json() as { error?: string };
          setError(result.error === "ImpactReviewPending" ? "30日以内の変更は影響確認機能が完成するまで保存できません。" : result.error === "AffectedReservations" ? "対象期間に未終了予約があります。影響確認機能が完成するまで保存できません。" : result.error === "ExistingPlanReviewPending" ? "同じ適用日の予定が既にあります。予定内容を確認できる編集画面が追加されるまで、この画面からは訂正できません。" : "設定が先に変更されました。再読み込みしてください。");
        } else setError("保存できませんでした。時間をおいて再試行してください。");
        return;
      }
      window.location.reload();
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  return { busy, error, save };
}

function Common({ error, busy }: { error: string; busy: boolean }) {
  return <>{error && <p role="alert" className="text-red-700">{error}</p>}<button type="submit" disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">{busy ? "保存中…" : "設定を保存"}</button></>;
}

function WeeklyForm({ data }: { data: ScheduleData }) {
  const { busy, error, save } = useSave();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const days = weekdays.map((_, weekday) => ({ weekday, isOpen: values.get(`open-${weekday}`) === "on", opensAt: values.get(`open-${weekday}`) === "on" ? values.get(`opens-${weekday}`) : null, closesAt: values.get(`closes-${weekday}`) }));
    save({ kind: "BUSINESS_WEEKLY", effectiveDate: values.get("effectiveDate"), expectedVersion: data.version, reason: values.get("reason"), days });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">曜日別の営業設定</h2>
    <p>現在有効な週間設定を初期表示します。休業日も締切計算用の閉店時刻を残します。</p>
    <div className="space-y-2">{weekdays.map((label, weekday) => {
      const day = data.weekly?.find((item) => item.weekday === weekday);
      return <div key={weekday} className="grid grid-cols-4 items-center gap-2"><span>{label}曜日</span><label><input type="checkbox" name={`open-${weekday}`} defaultChecked={day?.isOpen ?? weekday !== 0} /> 営業</label><label>開店<input name={`opens-${weekday}`} defaultValue={day?.opensAt ?? "09:00"} className="block w-full rounded border p-1" /></label><label>閉店<input name={`closes-${weekday}`} required defaultValue={day?.closesAt ?? "18:00"} className="block w-full rounded border p-1" /></label></div>;
    })}</div>
    <label className="block">適用日<input name="effectiveDate" type="date" required className="mt-1 block rounded border p-2" /></label>
    <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
    <Common error={error} busy={busy} />
  </form>;
}

function DailyForm({ data }: { data: ScheduleData }) {
  const { busy, error, save } = useSave();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const isOpen = values.get("isOpen") === "on";
    save({ kind: "BUSINESS_DATE", effectiveDate: values.get("effectiveDate"), expectedVersion: data.version, reason: values.get("reason"), isOpen, opensAt: isOpen ? values.get("opensAt") : null, closesAt: values.get("closesAt") });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">特定日の営業・休業</h2>
    <label className="block">対象日<input name="effectiveDate" type="date" required className="mt-1 block rounded border p-2" /></label>
    <label className="block"><input name="isOpen" type="checkbox" defaultChecked /> 営業する（外すと休業）</label>
    <div className="grid grid-cols-2 gap-3"><label>開店<input name="opensAt" defaultValue="09:00" className="mt-1 block w-full rounded border p-2" /></label><label>閉店<input name="closesAt" required defaultValue="18:00" className="mt-1 block w-full rounded border p-2" /></label></div>
    <p className="text-sm">休業でも閉店時刻は予約締切の計算に使います。</p>
    <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
    <Common error={error} busy={busy} />
  </form>;
}

function BreakForm({ data }: { data: ScheduleData }) {
  const { busy, error, save } = useSave();
  const [selectedId, setSelectedId] = useState(data.therapists[0]?.id ?? "");
  const selected = data.therapists.find((item) => item.id === selectedId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const breaks = weekdays.map((_, weekday) => {
      const start = values.get(`break-${weekday}`);
      if (typeof start !== "string" || !start) return { weekday, startsAt: null, endsAt: null };
      return { weekday, startsAt: start, endsAt: clock(Number(start.slice(0, 2)) + 1) };
    });
    save({ kind: "THERAPIST_BREAK", therapistId: selectedId, effectiveDate: values.get("effectiveDate"), expectedVersion: data.version, reason: values.get("reason"), breaks });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">施術者の曜日別休憩</h2>
    {data.therapists.length === 0 ? <p>有効な施術者がいません。先に施術者を追加してください。</p> : <>
      <label className="block">施術者<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 block w-full rounded border p-2">{data.therapists.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <div key={selectedId} className="grid gap-2 sm:grid-cols-2">{weekdays.map((label, weekday) => {
        const rest = selected?.days?.find((item) => item.weekday === weekday);
        return <label key={weekday} className="block">{label}曜日の休憩開始<select name={`break-${weekday}`} defaultValue={rest?.startsAt ?? ""} className="mt-1 block w-full rounded border p-2"><option value="">未設定（割当対象外）</option>{Array.from({ length: 23 }, (_, hour) => <option key={hour} value={clock(hour)}>{clock(hour)}〜{clock(hour + 1)}</option>)}</select></label>;
      })}</div>
      <label className="block">適用日<input name="effectiveDate" type="date" required className="mt-1 block rounded border p-2" /></label>
      <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
      <p>休憩は1時間で、その曜日の営業時間内に収めます。未設定の曜日にはその施術者を割り当てません。</p>
      <Common error={error} busy={busy} />
    </>}
  </form>;
}

export function ScheduleManager({ data, permissions }: { data: ScheduleData; permissions: StaffPermissionKey[] }) {
  const business = permissions.includes("BUSINESS_SETTING_MANAGE");
  const rest = permissions.includes("THERAPIST_BREAK_MANAGE");
  return <div className="space-y-8">
    <p>設定版：{data.version}</p>
    {business ? <><WeeklyForm data={data} /><DailyForm data={data} /></> : <p>営業設定の変更権限はありません。</p>}
    {rest ? <BreakForm data={data} /> : <p>施術者休憩の変更権限はありません。</p>}
  </div>;
}
