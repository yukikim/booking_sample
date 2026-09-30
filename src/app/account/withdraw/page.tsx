import { redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/auth/member";
import { getWithdrawalPreview } from "@/lib/member/withdraw-review";
import { WithdrawMemberForm } from "@/components/withdraw-member-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let preview;
  try { preview = await getWithdrawalPreview(); }
  catch (error) {
    if (error instanceof MemberAccessError && error.status === 401) redirect("/login");
    return <main className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-bold">退会画面を表示できません</h1><p>{error instanceof MemberAccessError && error.status === 403 ? "現在の会員状態では退会を受け付けられません。" : "現在会員情報を取得できません。時間をおいて再試行してください。"}</p></main>;
  }
  return <WithdrawMemberForm initialPreview={preview} />;
}
