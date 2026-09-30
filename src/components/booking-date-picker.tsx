"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addCalendarDays, calendarMonthCells, calendarMonths } from "@/lib/booking/calendar";
import { cn } from "@/lib/utils";

export type BookingSlot = { startsAt: string; treatmentEndsAt: string; occupiesUntil: string };
export type BookingAvailability = { totals: { totalDurationMinutes: number; totalPriceYen: number }; times: BookingSlot[]; outsideWindow: boolean };
type CalendarData = { today: string; endDate: string; days: { date: string; availableCount: number; outsideWindow: boolean }[] };
const dateLabel = (date: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00+09:00`));
const clock = (date: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(date));

export function BookingDatePicker({ initialToday, treatmentId, optionIds, enabled, date, slot, refreshKey, onSelect }: {
  initialToday: string; treatmentId: string; optionIds: string[]; enabled: boolean;
  date: string; slot: BookingSlot | null; refreshKey: number;
  onSelect: (date: string, slot: BookingSlot, availability: BookingAvailability) => void;
}) {
  const selectionKey = JSON.stringify([treatmentId, [...optionIds].sort()]);
  const [calendar, setCalendar] = useState<{ key: string; data: CalendarData } | null>(null);
  const [calendarError, setCalendarError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [result, setResult] = useState<BookingAvailability | null>(null);
  const [timeError, setTimeError] = useState(false);
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeRevision, setTimeRevision] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const ready = enabled && !loading && calendar?.key === selectionKey && !calendarError;
  const data = ready ? calendar.data : null;
  const today = calendar?.data.today ?? initialToday;
  const endDate = calendar?.data.endDate ?? addCalendarDays(today, 30);
  const months = calendarMonths(addCalendarDays(today, 1), endDate);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setCalendarError(false);
    });
    const [selectedTreatment, options] = JSON.parse(selectionKey) as [string, string[]];
    const params = new URLSearchParams({ treatmentId: selectedTreatment });
    options.forEach(id => params.append("optionId", id));
    void (async () => {
      try {
        const response = await fetch(`/api/availability/calendar?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = await response.json() as CalendarData;
        if (!controller.signal.aborted) setCalendar({ key: selectionKey, data: next });
      } catch {
        if (!controller.signal.aborted) setCalendarError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectionKey, enabled, revision, refreshKey]);

  useEffect(() => {
    if (!dialogDate || !enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setTimeLoading(true);
      setResult(null);
      setTimeError(false);
    });
    const [selectedTreatment, options] = JSON.parse(selectionKey) as [string, string[]];
    const params = new URLSearchParams({ date: dialogDate, treatmentId: selectedTreatment });
    options.forEach(id => params.append("optionId", id));
    void (async () => {
      try {
        const response = await fetch(`/api/availability?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = await response.json() as BookingAvailability;
        if (!controller.signal.aborted) {
          setResult(next);
          // If the last slot disappeared, immediately disable this day too.
          if (next.times.length === 0 || next.outsideWindow) setCalendar(current => current?.key === selectionKey ? { ...current, data: { ...current.data, days: current.data.days.map(day => day.date === dialogDate ? { ...day, availableCount: 0, outsideWindow: next.outsideWindow } : day) } } : current);
        }
      } catch {
        if (!controller.signal.aborted) setTimeError(true);
      } finally {
        if (!controller.signal.aborted) setTimeLoading(false);
      }
    })();
    return () => controller.abort();
  }, [dialogDate, selectionKey, enabled, timeRevision]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">日付を選ぶと、空き時間を選択できます。予約は翌日から30日先まで受け付けます。</p>
      {!enabled && <p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">先にメニュー・オプションを選択してください。</p>}
      {enabled && (loading || (!calendar && !calendarError)) && <p role="status" className="text-sm text-muted-foreground">カレンダーの空き状況を確認中です…</p>}
      {enabled && calendarError && <div role="alert" className="space-y-2"><p>空き状況を取得できませんでした。</p><Button type="button" variant="outline" onClick={() => setRevision(value => value + 1)}>再取得する</Button></div>}
      <div className={cn("grid gap-4", months.length > 1 && "lg:grid-cols-2")}>
        {months.map(month => (
          <div key={month} className="min-w-0 rounded-xl border p-2 sm:p-3">
            <table className="w-full table-fixed text-center text-sm">
              <caption className="pb-3 text-base font-semibold">{Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月</caption>
              <thead><tr>{["日", "月", "火", "水", "木", "金", "土"].map((label, index) => <th scope="col" key={label} className={cn("bg-transparent px-0 py-2 text-xs font-medium", index === 0 ? "text-red-700" : index === 6 ? "text-primary" : "text-muted-foreground")}>{label}</th>)}</tr></thead>
              <tbody>{calendarMonthCells(month).map((week, index) => <tr key={index}>{week.map((day, col) => {
                const status = data?.days.find(item => item.date === day);
                const available = !!status && status.availableCount > 0 && !status.outsideWindow;
                const reason = day && (day <= today || day > endDate) ? "受付期間外" : !ready ? "空き状況未確認" : status?.outsideWindow ? "受付期間外" : "空きなし";
                return <td key={day ?? `blank-${col}`} className="px-0 py-0.5">{day && <button type="button" disabled={!available} aria-label={`${dateLabel(day)} ${available ? "空きあり" : reason}`} aria-pressed={!!slot && date === day} title={available ? "空き時間を選ぶ" : reason} className={cn("flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-0 py-1 text-sm disabled:bg-muted disabled:text-slate-400 disabled:opacity-100", available && "text-primary hover:bg-secondary", available && slot && date === day && "bg-primary text-primary-foreground hover:bg-primary/90")} onClick={event => {
                  triggerRef.current = event.currentTarget;
                  setResult(null);
                  setTimeError(false);
                  setTimeLoading(true);
                  setDialogDate(day);
                }}><span>{Number(day.slice(8))}</span><span aria-hidden="true" className="text-[10px] leading-none">{available ? "○" : "−"}</span></button>}</td>;
              })}</tr>)}</tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>○ 空きあり　− 空きなし・受付期間外</p><Button type="button" variant="ghost" size="sm" disabled={!enabled || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />空きを更新</Button></div>
      {slot && <p className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm font-medium text-secondary-foreground"><CalendarDays aria-hidden="true" className="size-5 shrink-0" />{dateLabel(date)} {clock(slot.startsAt)}〜</p>}
      <Dialog open={dialogDate !== null && enabled} onOpenChange={open => { if (!open) setDialogDate(null); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); const button = triggerRef.current; if (button && !button.disabled) button.focus(); else document.getElementById("booking-calendar-heading")?.focus(); }}>
          <DialogHeader><DialogTitle>{dialogDate && dateLabel(dialogDate)}</DialogTitle><DialogDescription>ご希望の開始時刻を選んでください。空き状況は日付を開くたびに更新されます。</DialogDescription></DialogHeader>
          {timeLoading && <p role="status">空き時間を確認中です…</p>}
          {timeError && <div role="alert" className="space-y-3"><p>空き時間を取得できませんでした。</p><Button type="button" variant="outline" onClick={() => setTimeRevision(value => value + 1)}>再取得する</Button></div>}
          {!timeLoading && result && (result.outsideWindow || result.times.length === 0) && <p role="status">{result.outsideWindow ? "この日は予約受付期間外です。別の日付を選んでください。" : "この日の空き時間はなくなりました。別の日付を選んでください。"}</p>}
          {!timeLoading && !timeError && result && !result.outsideWindow && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{result.times.map(item => <Button key={item.startsAt} type="button" variant="outline" aria-label={`${clock(item.startsAt)}を選択`} onClick={() => {
            if (!dialogDate) return;
            onSelect(dialogDate, item, result);
            setDialogDate(null);
          }}>{clock(item.startsAt)}</Button>)}</div>}
          <Button type="button" variant="secondary" onClick={() => setDialogDate(null)}>カレンダーに戻る</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
