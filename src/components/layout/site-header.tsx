"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";
import type { Session } from "next-auth";
import { ArrowUpRight, Menu, Waves, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const [sessionState, setSessionState] = useState<{ pathname: string; session: Session | null } | null>(null);
  useEffect(() => {
    let current = true;
    const refreshSession = async () => {
      const session = await getSession({ broadcast: false }).catch(() => null);
      if (current) setSessionState({ pathname, session });
    };
    void refreshSession();
    window.addEventListener("focus", refreshSession);
    return () => {
      current = false;
      window.removeEventListener("focus", refreshSession);
    };
  }, [pathname]);
  const role = sessionState?.pathname === pathname ? sessionState.session?.user.role : undefined;
  const links = [
    { href: "/", label: "ホーム" },
    { href: "/book", label: "メニュー・Web予約" },
    ...(role === "MEMBER" ? [{ href: "/account", label: "マイページ" }] : []),
    ...(role === "ADMIN" ? [{ href: "/manage", label: "管理ページ" }] : []),
    { href: "/login", label: "ログイン" },
  ];
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const active = (href: string) => href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="border-b bg-card" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        setOpenFor(null);
        document.getElementById("menu-toggle")?.focus();
      }
    }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="予約サンプル ホーム" onClick={() => setOpenFor(null)}>
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><Waves aria-hidden="true" className="size-6" /></span>
          <span className="text-base font-bold tracking-tight sm:text-lg">予約サンプル<span className="mt-0.5 block text-[10px] font-medium tracking-widest text-muted-foreground">WELLNESS & RELAXATION</span></span>
        </Link>
        <nav aria-label="グローバルメニュー" className="hidden items-center gap-1 lg:flex">
          {links.map(({ href, label }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cn("rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-primary", active(href) && "bg-secondary text-primary")}>{label}</Link>)}
          <Button asChild className="ml-3"><Link href="/register?next=%2Fbook">会員登録<ArrowUpRight aria-hidden="true" /></Link></Button>
        </nav>
        <Button id="menu-toggle" variant="outline" size="icon" className="lg:hidden" aria-label={open ? "メニューを閉じる" : "メニューを開く"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpenFor(open ? null : pathname)}>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
      <nav id="mobile-menu" aria-label="モバイルグローバルメニュー" hidden={!open} className="border-t px-4 py-4 lg:hidden">
        <div className="mx-auto grid max-w-6xl gap-1">
          {links.map(({ href, label }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} onClick={() => setOpenFor(null)} className={cn("rounded-lg px-4 py-3 text-sm font-medium hover:bg-secondary", active(href) && "bg-secondary text-primary")}>{label}</Link>)}
          <Button asChild className="mt-2"><Link href="/register?next=%2Fbook" onClick={() => setOpenFor(null)}>会員登録<ArrowUpRight aria-hidden="true" /></Link></Button>
        </div>
      </nav>
    </header>
  );
}
