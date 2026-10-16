import { decode, encode } from "@auth/core/jwt";
import { requireSecret } from "@/lib/required-env";

export const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours (mirrors authOptions)
export const BACKUP_COOKIE = "impersonate_backup";
const PLAIN_COOKIE = "authjs.session-token";
const SECURE_COOKIE = "__Secure-authjs.session-token";

function isSecureRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // fall through to header check
  }
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export function sessionCookieName(request: Request): { name: string; secure: boolean } {
  const secure = isSecureRequest(request);
  return { name: secure ? SECURE_COOKIE : PLAIN_COOKIE, secure };
}

function secret(): string {
  return requireSecret(
    "NEXTAUTH_SECRET",
    "dev-only-nextauth-secret-do-not-use-in-production-12"
  );
}

function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function readSessionToken(request: Request): { name: string; value: string; secure: boolean } | null {
  const cookies = parseCookies(request);
  const { name, secure } = sessionCookieName(request);
  if (cookies[name]) return { name, value: cookies[name], secure };
  // Fall back to the other flavor (proxy/protocol mismatch edge cases).
  const alt = name === PLAIN_COOKIE ? SECURE_COOKIE : PLAIN_COOKIE;
  if (cookies[alt]) return { name: alt, value: cookies[alt], secure: alt === SECURE_COOKIE };
  return null;
}

export function readBackupToken(request: Request): string | null {
  return parseCookies(request)[BACKUP_COOKIE] ?? null;
}

export async function mintStaffToken(staff: {
  id: string;
  role: string;
  tokenVersion: number;
  adminId: string;
  salt: string;
}): Promise<{ value: string; salt: string }> {
  const value = await encode({
    secret: secret(),
    salt: staff.salt,
    maxAge: SESSION_MAX_AGE,
    token: {
      sub: staff.id,
      id: staff.id,
      role: staff.role,
      tokenVersion: staff.tokenVersion,
      impersonatedBy: staff.adminId,
    },
  });
  return { value, salt: staff.salt };
}

export async function decodeToken(
  raw: string,
  salt: string
): Promise<Record<string, unknown> | null> {
  try {
    return (await decode({ token: raw, secret: secret(), salt })) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function cookieFlags(secure: boolean, maxAge: number): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge };
}
