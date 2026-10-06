import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff } from "@/db/schema";
import { requireSecret } from "@/lib/required-env";

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(
    requireSecret("JWT_SECRET", "dev-only-jwt-secret-do-not-use-in-production-123456")
  );
}

const ISSUER = "jamicore-invoice";
const AUDIENCE = "jamicore-mobile";

export type ClientRole = "client" | "client_staff";

export interface ClientJWTPayload {
  sub: string; // Login row id: clients.id (owner) or client_staff.id (staff)
  role: ClientRole;
  clientId: string; // Owning client — ALL ownership checks use this, never sub
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  name: string; // Display name (owner or staff member name)
  staffName?: string | null; // Set when role === "client_staff"
  tv: number; // token_version at issue time — must match the live row
}

/**
 * Sign and issue a JWT token for an authenticated mobile user
 * (client owner via password, or client staff via PIN).
 * Expiration: 7 days (reduced from 30d to bound leaked-token impact).
 */
export async function signClientToken(payload: {
  id: string;
  role: ClientRole;
  clientId: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  name: string;
  staffName?: string | null;
  tv: number;
}): Promise<string> {
  return new SignJWT({
    sub: payload.id,
    role: payload.role,
    clientId: payload.clientId,
    username: payload.username ?? undefined,
    phone: payload.phone ?? undefined,
    email: payload.email ?? undefined,
    name: payload.name,
    staffName: payload.staffName ?? undefined,
    tv: payload.tv,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

/**
 * Verify client JWT token from Authorization header (Bearer <token>).
 * Returns the decoded payload or null if invalid/expired.
 */
export async function verifyClientToken(token: string): Promise<ClientJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const role = payload.role as string;
    if ((role !== "client" && role !== "client_staff") || !payload.sub || typeof payload.sub !== "string") {
      return null;
    }
    // No legacy fallback: clientId is mandatory and `tv` must be present.
    // Tokens issued before revocation support force a clean re-login.
    if (typeof payload.clientId !== "string" || payload.clientId.length === 0) {
      return null;
    }
    if (typeof payload.tv !== "number") {
      return null;
    }

    return {
      sub: payload.sub as string,
      role: role as ClientRole,
      clientId: payload.clientId as string,
      username: (payload.username as string | undefined) ?? null,
      phone: (payload.phone as string | undefined) ?? null,
      email: (payload.email as string | undefined) ?? null,
      name: (payload.name as string) || "",
      staffName: (payload.staffName as string | undefined) ?? null,
      tv: payload.tv as number,
    };
  } catch {
    return null;
  }
}

/**
 * Helper to extract and verify token directly from Next.js Request Authorization header.
 * Revalidates against the live row on EVERY call, so password/PIN resets,
 * deactivation and archiving take effect immediately instead of lingering
 * until the 7-day JWT expires:
 * - owner: row must exist, archived_at must be null, token_version === tv
 * - team staff: row must exist and be active, token_version === tv
 */
export async function authenticateClientRequest(request: Request): Promise<ClientJWTPayload | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  const payload = await verifyClientToken(token);
  if (!payload) return null;
  try {
    if (payload.role === "client_staff") {
      const row = await db.query.clientStaff.findFirst({
        where: eq(clientStaff.id, payload.sub),
      });
      if (!row || !row.isActive) return null;
      if ((row.tokenVersion ?? 0) !== payload.tv) return null;
      // The owning client being archived kills team tokens too.
      const home = await db.query.clients.findFirst({
        where: eq(clients.id, row.clientId),
      });
      if (!home || home.archivedAt) return null;
    } else {
      const row = await db.query.clients.findFirst({
        where: eq(clients.id, payload.sub),
      });
      if (!row || row.archivedAt) return null;
      if ((row.tokenVersion ?? 0) !== payload.tv) return null;
    }
  } catch {
    return null;
  }
  return payload;
}
