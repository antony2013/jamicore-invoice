import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limiter";
import { writeAudit } from "@/lib/audit";
import { requireSecret } from "@/lib/required-env";

/** Constant dummy hash — compared on miss so timing never reveals existence. */
const DUMMY_BCRYPT_HASH = "$2b$12$KIXxQG8h7vZ3mQwErTyUuO8hG5fSdFgHjKlZxCvBnM1q2w3e4r5t6y7u8i";

/** Best-effort client IP (Coolify/Traefik sets x-forwarded-for). */
function clientIp(request: unknown): string {
  const headers = (request as { headers?: { get?: (k: string) => string | null } })?.headers;
  const xff = headers?.get?.("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown-ip";
}

export const authOptions: NextAuthConfig = {
  // Required behind reverse proxies (Coolify/Traefik terminates HTTPS and
  // forwards plain HTTP): without this Auth.js rejects the host and all
  // /api/auth/* routes 500.
  trustHost: true,
  providers: [
    Credentials({
      name: "Staff Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);
        const ip = clientIp(request);

        // Brute-force guard BEFORE any DB lookup (silent null, no reveal).
        const [byIp, byEmail] = await Promise.all([
          checkRateLimit(`staff-login-ip:${ip}`, 30, 15 * 60 * 1000),
          checkRateLimit(`staff-login-email:${email}`, 10, 15 * 60 * 1000),
        ]);
        if (!byIp.allowed || !byEmail.allowed) {
          return null;
        }

        const user = await db.query.staff.findFirst({
          where: eq(staff.email, email),
        });

        // Unknown account: still burn bcrypt time so misses are
        // indistinguishable from wrong-passwords.
        if (!user) {
          await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
          await writeAudit(db, {
            actor: { type: "staff", id: email },
            action: "auth.login_failure",
            entityType: "staff",
            meta: { reason: "unknown_email" },
            ip,
          });
          return null;
        }

        // Deactivated accounts can never sign in.
        if ((user as { isActive?: boolean }).isActive === false) {
          await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
          await writeAudit(db, {
            actor: { type: "staff", id: user.id },
            action: "auth.login_failure",
            entityType: "staff",
            entityId: user.id,
            meta: { reason: "inactive" },
            ip,
          });
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await writeAudit(db, {
            actor: { type: "staff", id: user.id },
            action: "auth.login_failure",
            entityType: "staff",
            entityId: user.id,
            meta: { reason: "wrong_password" },
            ip,
          });
          return null;
        }

        // Opportunistic upgrade: old cost-10 hashes become cost-12 on login.
        try {
          if (bcrypt.getRounds(user.passwordHash) < 12) {
            const upgraded = await bcrypt.hash(password, 12);
            await db.update(staff).set({ passwordHash: upgraded }).where(eq(staff.id, user.id));
          }
        } catch {
          // Login already succeeded; upgrade is best-effort.
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tokenVersion: (user as { tokenVersion?: number }).tokenVersion ?? 0,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.tokenVersion = (user as any).tokenVersion ?? 0;
        return token;
      }
      // Returning sessions re-validate the account on every request:
      // missing row, deactivation, role change or revocation (token_version
      // bump) kills the JWT — and the live role is refreshed from the DB.
      if (token?.id) {
        const row = await db.query.staff.findFirst({
          where: eq(staff.id, token.id as string),
        });
        if (
          !row ||
          (row as { isActive?: boolean }).isActive === false ||
          ((row as { tokenVersion?: number }).tokenVersion ?? 0) !==
            ((token.tokenVersion as number | undefined) ?? 0)
        ) {
          return null as any;
        }
        token.role = row.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60, // 12 hours
    updateAge: 60 * 60, // refresh rolling session hourly
  },
  secret: requireSecret(
    "NEXTAUTH_SECRET",
    "dev-only-nextauth-secret-do-not-use-in-production-12"
  ),
};

// Exported for tests (callback unit tests); app code uses the bound helpers.
export const { handlers, signIn, signOut, auth } = NextAuth(authOptions);
