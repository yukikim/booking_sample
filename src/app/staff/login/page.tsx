import { LoginPage } from "@/components/auth/login-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default function Page() { return <LoginPage role="staff" />; }
