import "server-only";
import { randomUUID } from "node:crypto";
import { getPrisma, setTransactionSchema } from "@/lib/prisma";
import { StoreInputError, checkMutationOrigin, readJsonBody, requireStoreMutation } from "@/lib/auth/store-mutation";
import { configuredMailFrom, encryptMailPayload } from "@/lib/member/mail";
import { adjustmentCandidates } from "@/lib/manage/adjustment-candidates";
import { dispatchMailAfterResponse } from "@/lib/mail/immediate";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long", timeStyle: "short" });

export async function confirmChangeNoticeMail(request: Request, noticeId: string) {
  checkMutationOrigin(request);
  if (!uuid.test(noticeId)) throw new StoreInputError(400);
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StoreInputError(400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["expectedVersion", "confirmed"].includes(key)) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1 || input.confirmed !== true) throw new StoreInputError(400);
  const outcome = await getPrisma().$transaction(async (tx) => {
    await setTransactionSchema(tx);
    const actor = await requireStoreMutation(tx, request, "NOTICE_SEND");
    await tx.storeSettingState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await tx.$queryRaw`SELECT id FROM "StoreSettingState" WHERE id = 1 FOR UPDATE`;
    const reference = await tx.reservationChangeNotice.findUnique({ where: { id: noticeId }, select: { reservationId: true } });
    if (!reference) throw new StoreInputError(404);
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${reference.reservationId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ReservationChangeNotice" WHERE id = ${noticeId}::uuid FOR UPDATE`;
    const notice = await tx.reservationChangeNotice.findUniqueOrThrow({ where: { id: noticeId }, include: { reservation: { include: { member: { select: { status: true, isDeleted: true } }, options: { select: { optionId: true } } } }, deliveries: { where: { kind: "RESERVATION_CHANGE" }, select: { status: true } } } });
    if (notice.deliveries.length) return { queued: true, status: notice.deliveries[0].status, deliveryId: null };
    const reservation = notice.reservation;
    if (notice.version !== input.expectedVersion || notice.resolvedAt || notice.responseStatus === "RESOLVED" || notice.responseStatus === "IMPACT_RESOLVED_PENDING_REVIEW" || reservation.status !== "CONFIRMED" || reservation.version !== notice.reservationVersion || reservation.member.status !== "ACTIVE" || reservation.member.isDeleted) throw new StoreInputError(409);
    const now = new Date();
    const audit = await tx.auditLog.create({ data: { requestKey: randomUUID(), actorType: actor.role, ...(actor.role === "ADMIN" ? { actorAdminId: actor.principalId } : { actorStaffId: actor.principalId }), action: "CHANGE_NOTICE_SEND_CONFIRMED", targetType: "ReservationChangeNotice", targetId: noticeId, changes: { reservationId: reservation.id, reservationVersion: reservation.version, noticeVersion: notice.version } } });
    const subject = "ご予約について店舗へのご連絡のお願い";
    const candidates = await adjustmentCandidates(tx, reservation, now);
    const suggestions = candidates.length ? `同日の候補時刻（現在の空き状況）：\n${candidates.map(row => `・${dateTime.format(new Date(row.startsAt))}`).join("\n")}\n\n` : "元の予約日の前後2時間以内に空き候補がありません。別日時または取消についてご相談ください。\n\n";
    const text = `${reservation.memberLastNameSnapshot} ${reservation.memberFirstNameSnapshot} 様\n\n${dateTime.format(reservation.startsAt)}のご予約について、店舗の設定変更により調整が必要になりました。\n\n${suggestions}候補は仮押さえではなく、空き状況は変わる場合があります。候補の有無にかかわらず、お手数ですが店舗までご連絡ください。\n\nこのメールだけで予約日時の変更・取消は確定しません。店舗がご希望を伺い、改めて空きを確認して確定します。`;
    const encryptedPayload = encryptMailPayload({ from: configuredMailFrom(), to: reservation.memberEmailSnapshot, subject, text });
    const delivery = await tx.emailDelivery.create({ data: { requestKey: randomUUID(), kind: "RESERVATION_CHANGE", noticeId, confirmationAuditId: audit.id, recipient: reservation.memberEmailSnapshot, encryptedPayload, payloadKeyId: "v1", payloadExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000), createdAt: now, nextAttemptAt: now } });
    return { queued: true, status: "PENDING" as const, deliveryId: delivery.id };
  });
  if (outcome.deliveryId) dispatchMailAfterResponse(outcome.deliveryId);
  return { queued: outcome.queued, status: outcome.status };
}
