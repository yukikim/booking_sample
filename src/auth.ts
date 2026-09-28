import "server-only";
import NextAuth, { AuthError, CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getToken } from "next-auth/jwt";
import { authEnvironment } from "./lib/auth/config";
import { authenticate } from "./lib/auth/credentials";
import { LoginRateLimited } from "./lib/auth/rate-limit";
import { claimsFrom, safeRedirect, MEMBER_SESSION_SECONDS, type StoreRole } from "./lib/auth/policy";
import { resolveSession, revokeSession } from "./lib/auth/session";

class RateLimited extends CredentialsSignin { code = "rate_limited"; }
class AlreadySignedIn extends CredentialsSignin { code = "already_signed_in"; }
export class AuthUnavailable extends Error {}

// A fresh state per request: never share failures across concurrent users.
export function createStoreAuth() {
  const state = { unavailable: false, rateLimited: false, forbidden: false };
  const config: NextAuthConfig = {
    providers: (["ADMIN", "STAFF", "MEMBER"] as StoreRole[]).map((role) => Credentials({
      id: role.toLowerCase(), name: role === "ADMIN" ? "管理者" : role === "STAFF" ? "スタッフ" : "会員",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials, request) {
        try {
          const environment = authEnvironment();
          const previous = await getToken({ req: request, secret: environment.secret, secureCookie: environment.secure });
          if (await resolveSession(previous)) throw new AlreadySignedIn();
          return await authenticate(role, credentials, request);
        } catch (error) {
          if (error instanceof LoginRateLimited) {
            state.rateLimited = true;
            throw new RateLimited();
          }
          if (error instanceof CredentialsSignin) throw error;
          state.unavailable = true;
          throw new Error("Authentication unavailable.");
        }
      },
    })),
    session: { strategy: "jwt", maxAge: MEMBER_SESSION_SECONDS },
    pages: { signIn: "/staff/login", error: "/staff/login" },
    callbacks: {
      async jwt({ token, user }) {
        if (user) return { ...claimsFrom(user)! }; // No email, name, password or permissions.
        return await resolveSession(token) ? token : null;
      },
      async session({ session, token }) {
        const claims = claimsFrom(token)!;
        return { ...session, user: { id: claims.principalId, role: claims.role }, expires: new Date(claims.absoluteExpiry).toISOString() };
      },
      redirect({ url, baseUrl }) { return safeRedirect(url, baseUrl); },
    },
    events: {
      async signOut(message) {
        if ("token" in message) await revokeSession(message.token);
      },
    },
    logger: {
      // Auth.js swallows session/signOut errors. The outer handler must discard
      // its response (including cookie deletion) when persistence failed.
      error(error) {
        if (error instanceof AuthError && error.type === "MissingCSRF") state.forbidden = true;
        else if (!(error instanceof CredentialsSignin)) state.unavailable = true;
        // Never print library errors: their causes can contain request/DB secrets.
      },
      warn() {}, debug() {},
    },
  };
  const instance = NextAuth(() => {
    const env = authEnvironment();
    return { ...config, secret: env.secret, trustHost: true, useSecureCookies: env.secure };
  });
  return { ...instance, state };
}

/** Server-side entry point; DB/configuration failures must not become anonymous success. */
export async function getStoreSession() {
  try {
    const instance = createStoreAuth();
    const session = await instance.auth();
    if (instance.state.unavailable) throw new AuthUnavailable();
    return session?.user ? session : null;
  } catch { throw new AuthUnavailable("認証情報を確認できません。時間をおいて再試行してください。"); }
}
