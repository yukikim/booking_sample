import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">予約サンプル</h1>
      <p>
        メニューと空き時刻はどなたでも確認できます。予約の確定には会員ログインが必要です。
      </p>
      <nav className="flex flex-wrap gap-5 text-blue-700 underline">
        <Link href="/book">Web予約</Link>
        <Link href="/register?next=%2Fbook">会員登録</Link>
        <Link href="/login?next=%2Fbook">会員ログイン</Link>
        <Link href="/staff/login">店舗スタッフ</Link>
        <Link href="/admin/login">管理者</Link>
      </nav>
    </main>
  );
}
