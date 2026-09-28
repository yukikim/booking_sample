import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogManager } from "@/components/catalog-manager";
import { getStoreCapabilities, StoreAccessError } from "@/lib/auth/permissions";
import { listCatalog } from "@/lib/manage/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  let access;
  let catalog;
  try {
    access = await getStoreCapabilities();
    catalog = await listCatalog();
  } catch (error) {
    if (error instanceof StoreAccessError && error.status === 401) redirect("/staff/login");
    return <main className="p-8">メニュー情報を表示できません。時間をおいて再読み込みしてください。</main>;
  }
  return <main className="mx-auto max-w-4xl space-y-8 p-8">
    <h1 className="text-2xl font-bold">メニュー・オプション管理</h1>
    <p>時間は分単位、料金は税込の円単位で入力します。無効化した項目は履歴として残ります。</p>
    <CatalogManager kind="treatments" items={catalog.treatments} permissions={access.permissions} />
    <CatalogManager kind="options" items={catalog.options} permissions={access.permissions} />
    <Link href="/manage" className="underline">店舗画面へ戻る</Link>
  </main>;
}
