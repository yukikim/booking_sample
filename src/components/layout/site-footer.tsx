import Link from "next/link";
import { Waves } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="flex items-center gap-2 font-semibold"><Waves className="size-5 text-primary" aria-hidden="true" />予約サンプル</p><p className="mt-2 text-sm leading-7 text-muted-foreground">心とからだに、ひと息つく時間を。</p></div>
          <nav aria-label="フッターメニュー" className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <Link className="py-2 hover:text-primary" href="/book">Web予約</Link>
            <Link className="py-2 hover:text-primary" href="/account">マイページ</Link>
            <Link className="py-2 hover:text-primary" href="/staff/login">店舗スタッフ</Link>
            <Link className="py-2 hover:text-primary" href="/admin/login">管理者</Link>
          </nav>
        </div>
        <p className="mt-6 border-t pt-5 text-xs text-muted-foreground">© 予約サンプル</p>
      </div>
    </footer>
  );
}
