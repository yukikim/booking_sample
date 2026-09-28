"use client";

import { useState, type FormEvent } from "react";
import type { StaffPermissionKey } from "@/generated/prisma/enums";
import type { listManagedSchedules } from "@/lib/schedules/manage";

type ScheduleData = Awaited<ReturnType<typeof listManagedSchedules>>;
type UpcomingPlan = ScheduleData["upcoming"][number];
type Review = { mode: "ADVANCE" | "NEAR_TERM"; daysUntilEffective: number; reviewToken: string; impact: { reservationId: string; businessDate: string; startsAt: string; before: string | null; after: string | null; cutoffBefore: string | null; cutoffAfter: string | null }[] };
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function useSave(cancel = false) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const path = cancel ? "/api/manage/schedules/cancel" : "/api/manage/schedules";
  async function failure(response: Response) {
    if (response.status === 400) return "日付・時刻・理由を確認してください。時刻は正時、休憩は1時間です。";
    if (response.status === 401 || response.status === 403) return "この設定を変更する権限がありません。ログイン状態を確認してください。";
    if (response.status === 409) {
      const result = await response.json() as { error?: string };
      return result.error === "ReviewRequired" ? "予約や設定が変わりました。もう一度、影響を確認してください。" : result.error === "ExistingPlanReviewPending" ? "同じ適用日の予定があります。予定一覧からその内容を確認して訂正してください。" : "設定が先に変更されました。再読み込みしてください。";
    }
    return "処理できませんでした。時間をおいて再試行してください。";
  }
  async function save(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(""); setReview(null); setBody(null);
    try {
      const response = await fetch(cancel ? path : `${path}/preview`, { method: cancel ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setError(await failure(response)); return; }
      setReview(await response.json() as Review); setBody(body);
    } catch { setError("通信に失敗しました。再試行してください。"); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (busy || !body || !review) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, reviewToken: review.reviewToken }) });
      if (!response.ok) { setError(await failure(response)); setReview(null); return; }
      window.location.reload();
    } catch { setError("通信に失敗しました。再試行してください。"); setReview(null); }
    finally { setBusy(false); }
  }
  return { busy, error, review, save, confirm };
}

const reasonText: Record<string, string> = { BUSINESS_CLOSED: "休業", OUTSIDE_BUSINESS_HOURS: "営業時間外", BREAK_UNSET: "施術者の休憩未設定", OVERLAPS_BREAK: "施術者の休憩と重複", RESOURCE_UNAVAILABLE: "部屋・施術者が無効" };
function ReviewPanel({ review, busy, confirm }: { review: Review | null; busy: boolean; confirm: () => void }) {
  if (!review) return null;
  const impacted = review.impact.filter((row) => row.after && row.before !== row.after);
  const resolved = review.impact.filter((row) => row.before && !row.after);
  const deadline = review.impact.filter((row) => row.cutoffBefore !== row.cutoffAfter);
  return <section className="space-y-3 rounded border-2 border-amber-500 p-4" aria-label="影響確認">
    <h3 className="font-bold">保存前の影響確認</h3>
    <p>適用まで{review.daysUntilEffective}日：{review.mode === "NEAR_TERM" ? "直近変更（30日以内）" : "通常の事前変更"}</p>
    <p>新たに要調整：{impacted.length}件／影響解消・店舗確認待ち：{resolved.length}件／受付締切の変更：{deadline.length}件</p>
    {review.impact.length > 0 && <ul className="space-y-1 text-sm">{review.impact.map((row) => <li key={row.reservationId}>{row.businessDate}・予約 {row.reservationId.slice(0, 8)}：{row.after ? reasonText[row.after] ?? row.after : "施術可能"}{row.cutoffBefore !== row.cutoffAfter ? `／受付締切 ${row.cutoffBefore ?? "未設定"} → ${row.cutoffAfter ?? "未設定"}` : ""}</li>)}</ul>}
    <p>予約と占有枠は維持します。案内メールは自動送信しません。</p>
    <button type="button" disabled={busy} onClick={confirm} className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "確定中…" : "確認して確定"}</button>
  </section>;
}

function Common({ error, busy, review, confirm }: ReturnType<typeof useSave>) {
  return <>{error && <p role="alert" className="text-red-700">{error}</p>}<button type="submit" disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">{busy ? "確認中…" : "影響を確認"}</button><ReviewPanel review={review} busy={busy} confirm={confirm} /></>;
}

function EffectiveDateInput({ today, plan, label = "適用日" }: { today: string; plan?: UpcomingPlan; label?: string }) {
  const [value, setValue] = useState(plan?.effectiveDate ?? "");
  const days = value ? (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 : null;
  return <label className="block">{label}<input name="effectiveDate" type="date" min={new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)} required value={value} onChange={(event) => setValue(event.target.value)} disabled={!!plan} className="mt-1 block rounded border p-2" />{days !== null && <span className="mt-1 block text-sm">{days < 1 ? "過去・当日は設定できません" : days <= 30 ? `直近変更（${days}日後）：影響確認が必要` : `通常の事前変更（${days}日後）`}</span>}</label>;
}

function WeeklyForm({ data, plan }: { data: ScheduleData; plan?: UpcomingPlan }) {
  const controls = useSave();
  const saved = plan?.setting?.kind === "BUSINESS_WEEKLY" ? plan.setting.days : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const days = weekdays.map((_, weekday) => ({ weekday, isOpen: values.get(`open-${weekday}`) === "on", opensAt: values.get(`open-${weekday}`) === "on" ? values.get(`opens-${weekday}`) : null, closesAt: values.get(`closes-${weekday}`) }));
    controls.save({ kind: "BUSINESS_WEEKLY", effectiveDate: plan?.effectiveDate ?? values.get("effectiveDate"), expectedVersion: data.version, ...(plan ? { expectedRevision: plan.revision } : {}), reason: values.get("reason"), days });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">曜日別の営業設定{plan ? "の訂正" : ""}</h2>
    <p>{plan ? "選択した予定の内容を表示します。" : "現在有効な週間設定を初期表示します。"}休業日も締切計算用の閉店時刻を残します。</p>
    <div className="space-y-2">{weekdays.map((label, weekday) => {
      const planned = saved?.find((item) => item.weekday === weekday);
      const day = planned ? { ...planned, opensAt: planned.opensAt === null ? null : clock(planned.opensAt), closesAt: clock(planned.closesAt) } : data.weekly?.find((item) => item.weekday === weekday);
      return <div key={weekday} className="grid grid-cols-4 items-center gap-2"><span>{label}曜日</span><label><input type="checkbox" name={`open-${weekday}`} defaultChecked={day?.isOpen ?? weekday !== 0} /> 営業</label><label>開店<input name={`opens-${weekday}`} defaultValue={day?.opensAt ?? "09:00"} className="block w-full rounded border p-1" /></label><label>閉店<input name={`closes-${weekday}`} required defaultValue={day?.closesAt ?? "18:00"} className="block w-full rounded border p-1" /></label></div>;
    })}</div>
    <EffectiveDateInput today={data.today} plan={plan} />
    <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
    <Common {...controls} />
  </form>;
}

function DailyForm({ data, plan }: { data: ScheduleData; plan?: UpcomingPlan }) {
  const controls = useSave();
  const saved = plan?.setting?.kind === "BUSINESS_DATE" ? plan.setting : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const isOpen = values.get("isOpen") === "on";
    controls.save({ kind: "BUSINESS_DATE", effectiveDate: plan?.effectiveDate ?? values.get("effectiveDate"), expectedVersion: data.version, ...(plan ? { expectedRevision: plan.revision } : {}), reason: values.get("reason"), isOpen, opensAt: isOpen ? values.get("opensAt") : null, closesAt: values.get("closesAt") });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">特定日の営業・休業{plan ? "の訂正" : ""}</h2>
    <EffectiveDateInput today={data.today} plan={plan} label="対象日" />
    <label className="block"><input name="isOpen" type="checkbox" defaultChecked={saved?.isOpen ?? true} /> 営業する（外すと休業）</label>
    <div className="grid grid-cols-2 gap-3"><label>開店<input name="opensAt" defaultValue={saved?.opensAt === null ? "09:00" : saved?.opensAt === undefined ? "09:00" : clock(saved.opensAt)} className="mt-1 block w-full rounded border p-2" /></label><label>閉店<input name="closesAt" required defaultValue={saved ? clock(saved.closesAt) : "18:00"} className="mt-1 block w-full rounded border p-2" /></label></div>
    <p className="text-sm">休業でも閉店時刻は予約締切の計算に使います。</p>
    <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
    <Common {...controls} />
  </form>;
}

function BreakForm({ data, plan }: { data: ScheduleData; plan?: UpcomingPlan }) {
  const controls = useSave();
  const saved = plan?.setting?.kind === "THERAPIST_BREAK" ? plan.setting : null;
  const [selectedId, setSelectedId] = useState(saved?.therapistId ?? data.therapists[0]?.id ?? "");
  const selected = data.therapists.find((item) => item.id === selectedId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const breaks = weekdays.map((_, weekday) => {
      const start = values.get(`break-${weekday}`);
      if (typeof start !== "string" || !start) return { weekday, startsAt: null, endsAt: null };
      return { weekday, startsAt: start, endsAt: clock(Number(start.slice(0, 2)) + 1) };
    });
    controls.save({ kind: "THERAPIST_BREAK", therapistId: selectedId, effectiveDate: plan?.effectiveDate ?? values.get("effectiveDate"), expectedVersion: data.version, ...(plan ? { expectedRevision: plan.revision } : {}), reason: values.get("reason"), breaks });
  }
  return <form onSubmit={submit} className="space-y-4 rounded border p-5">
    <h2 className="text-xl font-bold">施術者の曜日別休憩{plan ? "の訂正" : ""}</h2>
    {data.therapists.length === 0 ? <p>有効な施術者がいません。先に施術者を追加してください。</p> : <>
      <label className="block">施術者<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!!plan} className="mt-1 block w-full rounded border p-2">{data.therapists.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <div key={selectedId} className="grid gap-2 sm:grid-cols-2">{weekdays.map((label, weekday) => {
        const rest = saved?.breaks.find((item) => item.weekday === weekday);
        const initial = rest ? (rest.startsAt === null ? "" : clock(rest.startsAt)) : selected?.days?.find((item) => item.weekday === weekday)?.startsAt ?? "";
        return <label key={weekday} className="block">{label}曜日の休憩開始<select name={`break-${weekday}`} defaultValue={initial} className="mt-1 block w-full rounded border p-2"><option value="">未設定（割当対象外）</option>{Array.from({ length: 23 }, (_, hour) => <option key={hour} value={clock(hour)}>{clock(hour)}〜{clock(hour + 1)}</option>)}</select></label>;
      })}</div>
      <EffectiveDateInput today={data.today} plan={plan} />
      <label className="block">変更理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
      <p>休憩は1時間で、その曜日の営業時間内に収めます。未設定の曜日にはその施術者を割り当てません。</p>
      <Common {...controls} />
    </>}
  </form>;
}

function PlanDetails({ plan }: { plan: UpcomingPlan }) {
  const setting = plan.setting;
  if (!setting) return <p>取消済み。以前の設定を対象日から使用します。</p>;
  if (setting.kind === "BUSINESS_DATE") return <p>{setting.isOpen ? `営業 ${clock(setting.opensAt!)}〜${clock(setting.closesAt)}` : `休業（締切用の閉店 ${clock(setting.closesAt)}）`}</p>;
  if (setting.kind === "BUSINESS_WEEKLY") return <p>{setting.days.map((day) => `${weekdays[day.weekday]}:${day.isOpen ? `${clock(day.opensAt!)}〜${clock(day.closesAt)}` : `休業・${clock(day.closesAt)}締切`}`).join(" ／ ")}</p>;
  return <p>{setting.breaks.map((day) => `${weekdays[day.weekday]}:${day.startsAt === null ? "未設定" : `${clock(day.startsAt)}〜${clock(day.endsAt!)}`}`).join(" ／ ")}</p>;
}

function CancelForm({ data, plan }: { data: ScheduleData; plan: UpcomingPlan }) {
  const controls = useSave(true);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    controls.save({ planId: plan.id, expectedVersion: data.version, expectedRevision: plan.revision, reason: values.get("reason") });
  }
  return <form onSubmit={submit} className="space-y-3 rounded border border-red-500 p-4">
    <h3 className="font-bold">{plan.effectiveDate}適用予定の取消</h3>
    <p>取消前後の予約影響を確認してから確定します。旧版と予約・占有枠は残ります。</p>
    <label className="block">取消理由<input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" /></label>
    <Common {...controls} />
  </form>;
}

function EffectiveLookup({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<{ business: { isOpen: boolean; opensAt: string | null; closesAt: string; source: string } | null; therapists: { id: string; name: string; assignable: boolean; rest: { startsAt: string | null; endsAt: string | null } | null }[] } | null>(null);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/manage/schedules?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!response.ok) { setError("対象日の設定を取得できませんでした。"); return; }
      setResult(await response.json());
    } catch { setError("通信に失敗しました。"); }
  }
  const displayHour = (value: string | null) => value ? `${value.slice(11, 13)}:${value.slice(14, 16)}` : "未設定";
  return <section className="space-y-3 rounded border p-5"><h2 className="text-xl font-bold">対象日の有効設定</h2><form onSubmit={submit} className="flex flex-wrap items-end gap-3"><label>対象日<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setResult(null); }} required className="mt-1 block rounded border p-2" /></label><button type="submit" className="rounded bg-black px-4 py-2 text-white">取得</button></form>{error && <p role="alert" className="text-red-700">{error}</p>}{result && <div className="space-y-2"><p>{result.business ? `${result.business.isOpen ? "営業" : "休業"}（${result.business.source === "DAILY" ? "日別" : "週間"}）：${displayHour(result.business.opensAt)}〜${displayHour(result.business.closesAt)}` : "営業設定なし"}</p><ul>{result.therapists.map((person) => <li key={person.id}>{person.name}：{person.assignable ? `割当候補・休憩 ${displayHour(person.rest?.startsAt ?? null)}〜${displayHour(person.rest?.endsAt ?? null)}` : "割当対象外"}</li>)}</ul></div>}</section>;
}

export function ScheduleManager({ data, permissions }: { data: ScheduleData; permissions: StaffPermissionKey[] }) {
  const business = permissions.includes("BUSINESS_SETTING_MANAGE");
  const rest = permissions.includes("THERAPIST_BREAK_MANAGE");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const selected = data.upcoming.find((plan) => plan.id === selectedId && !plan.canceled);
  const cancelPlan = data.upcoming.find((plan) => plan.id === cancelId && !plan.canceled);
  return <div className="space-y-8">
    <p>設定版：{data.version}</p>
    <EffectiveLookup today={data.today} />
    <section className="space-y-3"><h2 className="text-xl font-bold">適用予定一覧</h2>
      {data.upcoming.length === 0 ? <p>適用予定はありません。</p> : <ul className="space-y-4">{data.upcoming.map((plan) => {
        const allowed = plan.kind === "THERAPIST_BREAK" ? rest : business;
        const setting = plan.setting;
        const editable = plan.kind !== "THERAPIST_BREAK" || setting?.kind === "THERAPIST_BREAK" && data.therapists.some((person) => person.id === setting.therapistId);
        return <li key={plan.id} className="space-y-2 rounded border p-4"><p className="font-bold">{plan.effectiveDate}・{plan.kind === "BUSINESS_WEEKLY" ? "週間営業" : plan.kind === "BUSINESS_DATE" ? "特定日営業" : `${plan.therapistName ?? "施術者"}の休憩`}・版{plan.revision}・{plan.canceled ? "取消済み" : plan.mode === "NEAR_TERM" ? "直近変更" : "通常変更"}</p><PlanDetails plan={plan} /><p className="text-sm">理由：{plan.reason}</p>{allowed && !plan.canceled && <div className="flex gap-3">{editable && <button type="button" className="underline" onClick={() => { setSelectedId(plan.id); setCancelId(null); }}>訂正</button>}<button type="button" className="underline" onClick={() => { setCancelId(plan.id); setSelectedId(null); }}>取消</button></div>}</li>;
      })}</ul>}
    </section>
    {cancelPlan && <CancelForm key={cancelPlan.id} data={data} plan={cancelPlan} />}
    {selected && <section className="space-y-3"><button type="button" className="underline" onClick={() => setSelectedId(null)}>新規設定に戻る</button>{selected.kind === "BUSINESS_WEEKLY" ? <WeeklyForm key={selected.id} data={data} plan={selected} /> : selected.kind === "BUSINESS_DATE" ? <DailyForm key={selected.id} data={data} plan={selected} /> : <BreakForm key={selected.id} data={data} plan={selected} />}</section>}
    {!selected && <>{business ? <><WeeklyForm data={data} /><DailyForm data={data} /></> : <p>営業設定の変更権限はありません。</p>}{rest ? <BreakForm data={data} /> : <p>施術者休憩の変更権限はありません。</p>}</>}
  </div>;
}
