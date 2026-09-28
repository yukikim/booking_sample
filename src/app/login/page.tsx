import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default function Page() { return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="text-2xl font-bold">会員ログイン</h1><LoginForm role="member" /><nav className="flex gap-4 text-blue-700 underline"><Link href="/register">会員登録</Link><Link href="/forgot-password">パスワードを忘れた場合</Link></nav></main>; }
