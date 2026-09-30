import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Clock3, Heart, Leaf, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { icon: Leaf, title: "メニューを選ぶ", description: "施術メニューとオプションを確認して、ご希望の組み合わせを選択。" },
  { icon: CalendarDays, title: "空き時間を探す", description: "ご希望の日付から空き時間を検索。予定に合う時間を選べます。" },
  { icon: Check, title: "ログインして予約", description: "会員ログイン後に内容を確認して予約。マイページから予約内容を確認できます。" },
];

export default function Home() {
  return (
    <main className="home-page mx-auto max-w-6xl overflow-hidden">
      <section className="grid gap-10 bg-linear-to-br from-secondary via-card to-accent/50 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:px-14 lg:py-18">
        <div>
          <p className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary"><span className="h-px w-7 bg-primary" />WELLNESS & RELAXATION</p>
          <h1 className="text-3xl leading-[1.55] font-bold tracking-tight sm:text-4xl lg:text-5xl">心とからだに、<br />ひと息つく時間を。</h1>
          <p className="mt-5 max-w-md text-sm leading-8 text-muted-foreground sm:text-base">毎日の忙しさから、少し離れて。<br />あなたのペースで、リラクゼーションの時間を。<br />メニュー選びからご予約まで、スマートに。</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg"><Link href="/book">メニュー・空き時間を見る<ArrowRight aria-hidden="true" /></Link></Button>
            <Button asChild variant="outline" size="lg"><Link href="/register?next=%2Fbook">初めての方・会員登録</Link></Button>
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">メニュー・空き時間の確認は、ログインせずにご利用いただけます。</p>
        </div>
        <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
          <div aria-hidden="true" className="absolute -top-4 -right-3 size-28 rounded-full border border-primary/15 sm:size-40" />
          <div aria-hidden="true" className="absolute -bottom-4 -left-3 size-24 rounded-full bg-accent" />
          <Card className="relative border-white/80 bg-card/95 p-6 sm:p-8">
            <div className="flex items-center justify-between"><span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary"><Waves aria-hidden="true" className="size-7" /></span><span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">自分をいたわる時間</span></div>
            <p className="mt-6 text-xs font-semibold tracking-widest text-muted-foreground">YOUR WELLNESS TIME</p>
            <h2 className="mt-2 text-2xl leading-relaxed font-semibold">次のひと息を、<br />ここから。</h2>
            <div className="mt-6 space-y-4 border-t pt-6">
              <p className="flex items-center gap-3 text-sm"><CalendarDays className="size-5 text-primary" aria-hidden="true" />ご都合に合わせて空き時間を検索</p>
              <p className="flex items-center gap-3 text-sm"><Clock3 className="size-5 text-primary" aria-hidden="true" />施術時間と料金を確認して予約</p>
              <p className="flex items-center gap-3 text-sm"><Heart className="size-5 text-primary" aria-hidden="true" />ご予約はマイページで確認</p>
            </div>
            <Button asChild variant="secondary" className="mt-6 w-full"><Link href="/book">Web予約を始める<ArrowRight aria-hidden="true" /></Link></Button>
          </Card>
        </div>
      </section>
      <section className="px-6 py-10 sm:px-10 sm:py-14 lg:px-14" aria-labelledby="booking-guide">
        <p className="text-xs font-semibold tracking-widest text-primary">HOW TO BOOK</p>
        <h2 id="booking-guide" className="mt-2 text-2xl font-bold">ご予約は、3つのステップで。</h2>
        <p className="mt-3 text-sm text-muted-foreground">予約の確定には会員登録・ログインが必要です。</p>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, description }, index) => (
            <Card key={title} className="shadow-none">
              <CardHeader><div className="mb-3 flex items-center justify-between"><span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-primary"><Icon className="size-5" aria-hidden="true" /></span><span className="text-xs font-semibold tracking-wider text-muted-foreground">STEP 0{index + 1}</span></div><CardTitle>{title}</CardTitle></CardHeader>
              <CardContent><CardDescription>{description}</CardDescription></CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-3 rounded-xl bg-muted px-5 py-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">すでに会員の方は、ログインしてご予約へ。</p><Button asChild variant="outline"><Link href="/login?next=%2Fbook">会員ログイン<ArrowRight aria-hidden="true" /></Link></Button></div>
      </section>
    </main>
  );
}
