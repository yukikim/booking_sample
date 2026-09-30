import Link from "next/link";
import { getStoreSession } from "@/auth";
import { LoginForm, LogoutButton } from "./login-form";
export async function LoginPage({ role }: { role: "admin" | "staff" }) {
  let session;
  try {
    session = await getStoreSession();
  } catch {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1>現在ログインできません</h1>
        <p>時間をおいて再読み込みしてください。</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-md space-y-6 p-8">
      <h1 className="text-2xl font-bold">
        {role === "admin" ? "管理者" : "スタッフ"}ログイン
      </h1>
      {session ? (
        <>
          <p>ログイン済みです。</p>
          <Link href="/manage" className="underline">
            店舗画面へ
          </Link>
          <LogoutButton />
        </>
      ) : (
        <LoginForm role={role} />
      )}
      <Link
        href={role === "admin" ? "/staff/login" : "/admin/login"}
        className="block underline"
      >
        {role === "admin" ? "スタッフ" : "管理者"}の方はこちら
      </Link>
    </main>
  );
}
