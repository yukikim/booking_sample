import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, Reservation } from "@/generated/prisma/client";
import { adminEnvironment, authEnvironment } from "@/lib/auth/config";
import { configuredMailFrom, encryptMailPayload } from "@/lib/member/mail";

const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const yen = new Intl.NumberFormat("ja-JP");

/** Both receipts commit with the reservation. Each recipient has a separate retry history. */
export async function queueReservationConfirmation(tx: Prisma.TransactionClient, reservation: Reservation, options: { name: string }[]) {
  return queueReservationMail(tx, reservation, options, "CONFIRMED");
}

export async function queueReservationCancellation(tx: Prisma.TransactionClient, reservation: Reservation, options: { name: string }[]) {
  return queueReservationMail(tx, reservation, options, "CANCELLED");
}

async function queueReservationMail(tx: Prisma.TransactionClient, reservation: Reservation, options: { name: string }[], status: "CONFIRMED" | "CANCELLED") {
  const cancelled = status === "CANCELLED";
  const now = new Date();
  const origin = authEnvironment().origin;
  const from = configuredMailFrom();
  const details = `予約番号：${reservation.id}\n予約日時：${dateTime.format(reservation.startsAt)} ～ ${dateTime.format(reservation.treatmentEndsAt)}（日本時間）\n施術：${reservation.treatmentNameSnapshot}\nオプション：${options.map(option => option.name).join("、") || "なし"}\n施術時間：${reservation.totalDurationMinutes}分\n合計料金：${yen.format(reservation.totalPriceYen)}円\n担当：${reservation.therapistNameSnapshot}`;
  const outcome = cancelled ? "キャンセルが完了しました" : "ご予約が確定しました";
  const cancellation = cancelled ? `\nキャンセル日時：${dateTime.format(reservation.cancelledAt!)}（日本時間）` : "";
  const deliveries = [
    { kind: cancelled ? "RESERVATION_CANCELLED_MEMBER" as const : "RESERVATION_CONFIRMED_MEMBER" as const, to: reservation.memberEmailSnapshot, subject: cancelled ? "ご予約のキャンセルが完了しました" : "ご予約が確定しました", text: `${reservation.memberLastNameSnapshot} ${reservation.memberFirstNameSnapshot} 様\n\n${outcome}。\n\n${details}${cancellation}\n\n${cancelled ? "キャンセルした予約の詳細は、ログイン後に確認できます。" : "予約の確認・変更・取消は、ログイン後に次のページから行えます。"}\n${origin}/account/reservations/${reservation.id}` },
    { kind: cancelled ? "RESERVATION_CANCELLED_ADMIN" as const : "RESERVATION_CONFIRMED_ADMIN" as const, to: adminEnvironment().email, subject: cancelled ? "会員が予約をキャンセルしました" : "会員の予約が確定しました", text: `${cancelled ? "会員本人が予約をキャンセルしました" : "会員からの予約が確定しました"}。\n\n会員：${reservation.memberLastNameSnapshot} ${reservation.memberFirstNameSnapshot} 様\n${details}${cancellation}\n部屋：${reservation.roomNameSnapshot}\n\n予約の詳細は、管理者としてログイン後に確認できます。\n${origin}/manage/reservations/${reservation.id}` },
  ];
  const ids: string[] = [];
  for (const { kind, to, subject, text } of deliveries) {
    const delivery = await tx.emailDelivery.create({ data: {
      requestKey: randomUUID(), kind, reservationId: reservation.id, reservationVersion: reservation.version,
      recipient: to, encryptedPayload: encryptMailPayload({ from, to, subject, text }), payloadKeyId: "v1",
      payloadExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000), createdAt: now, nextAttemptAt: now,
    } });
    ids.push(delivery.id);
  }
  return ids;
}
