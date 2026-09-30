import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStoreAction, StoreAccessError } from "@/lib/auth/permissions";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  try {
    await requireStoreAction("MEMBER_REVIEW");
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401)
      redirect("/staff/login");
    return <main className="p-8">氏名一致審査は管理者のみ閲覧できます。</main>;
  }
  const reviews = await getPrisma().memberReview.findMany({
    where: { decision: "PENDING" },
    include: {
      member: {
        select: { lastName: true, firstName: true, email: true, status: true },
      },
      _count: { select: { matches: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">氏名一致の審査</h1>
      <p>
        退会者と氏名が一致する入会申込を確認します。別人と確認できた場合のみ有効化してください。
      </p>
      <p>未審査 {reviews.length}件（最大100件）</p>
      <ul className="space-y-2">
        {reviews.map((row) => (
          <li className="rounded border p-3" key={row.id}>
            <Link
              className="underline"
              href={`/manage/members/reviews/${row.id}`}
            >
              {row.member.lastName} {row.member.firstName}／{row.member.email}
            </Link>
            ・一致候補{row._count.matches}件・{row.member.status}
          </li>
        ))}
      </ul>
      <Link className="block underline" href="/manage/members">
        会員検索へ戻る
      </Link>
    </main>
  );
}
