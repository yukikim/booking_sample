import Link from "next/link";

export default function Home() {
  return <main className="mx-auto max-w-xl space-y-6 p-8">
    <h1 className="text-3xl font-bold">予約サンプル</h1>
    <p>会員登録とログインから始められます。予約機能は今後のタスクで追加します。</p>
    <nav className="flex flex-wrap gap-5 text-blue-700 underline"><Link href="/register">会員登録</Link><Link href="/login">会員ログイン</Link><Link href="/staff/login">店舗スタッフ</Link><Link href="/admin/login">管理者</Link></nav>
  </main>;
}
