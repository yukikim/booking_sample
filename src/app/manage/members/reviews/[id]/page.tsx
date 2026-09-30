import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberReviewDecision } from "@/components/member-review-decision";
import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requireStoreAction("MEMBER_REVIEW");
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return <main className="p-8">氏名一致審査は管理者のみ閲覧できます。</main>;
  }
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const review = await getPrisma().memberReview.findUnique({
    where: { id },
    include: {
      member: true,
      matches: {
        include: {
          matchedMember: {
            select: {
              id: true,
              lastName: true,
              firstName: true,
              email: true,
              phoneNumber: true,
              status: true,
              createdAt: true,
              firstActivatedAt: true,
            },
          },
        },
      },
    },
  });
  if (!review) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">氏名一致の審査詳細</h1>
      <section className="rounded border p-4">
        <h2 className="font-semibold">申込者</h2>
        <p>
          {review.member.lastName} {review.member.firstName}／
          {review.member.email}／{review.member.phoneNumber}
        </p>
        <p>
          状態：{review.member.status}／審査：{review.decision}
        </p>
        <p>
          申込日：
          {review.member.createdAt.toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          })}
        </p>
      </section>
      <section className="rounded border p-4">
        <h2 className="font-semibold">氏名一致の退会者</h2>
        <ul className="space-y-2">
          {review.matches.map((row) => (
            <li key={row.matchedMemberId}>
              <p>
                {row.matchedMember.lastName} {row.matchedMember.firstName}／
                {row.matchedMember.email}／{row.matchedMember.phoneNumber}
              </p>
              <p>
                現在の状態：{row.matchedMember.status}／初回有効化：
                {row.matchedMember.firstActivatedAt?.toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                }) ?? "なし"}
              </p>
              <Link
                className="underline"
                href={`/manage/members/${row.matchedMemberId}`}
              >
                会員履歴を見る
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {review.decision === "PENDING" &&
      review.member.status === "PENDING_REVIEW" ? (
        <MemberReviewDecision
          id={id}
          reviewVersion={review.version}
          memberVersion={review.member.version}
        />
      ) : (
        <p>
          審査済み：{review.decision}／理由：{review.reason ?? "なし"}
        </p>
      )}
      <Link className="block underline" href="/manage/members/reviews">
        審査一覧へ戻る
      </Link>
    </main>
  );
}
