import type { SessionClaims, StoreRole } from "../lib/auth/policy";
import "next-auth";
declare module "next-auth" {
  interface User extends SessionClaims { id: string; }
  interface Session {
    user: { id: string; role: StoreRole };
  }
}
