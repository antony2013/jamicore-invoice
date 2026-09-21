import { SignJWT, jwtVerify } from "jose";

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is not set. Refusing to start with a fallback secret in production.");
    }
    // Dev-only fallback (never committed to prod env)
    return new TextEncoder().encode("dev-only-jwt-secret-do-not-use-in-production-123456");
  }
  return new TextEncoder().encode(secret);
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
    // Legacy tokens (pre-team, role always "client", sub === client id):
    // clientId claim missing -> sub IS the client id.
    const clientId =
      typeof payload.clientId === "string" && payload.clientId.length > 0
        ? payload.clientId
        : (payload.sub as string);

    return {
      sub: payload.sub as string,
      role: role as ClientRole,
      clientId,
      username: (payload.username as string | undefined) ?? null,
      phone: (payload.phone as string | undefined) ?? null,
      email: (payload.email as string | undefined) ?? null,
      name: (payload.name as string) || "",
      staffName: (payload.staffName as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Helper to extract and verify token directly from Next.js Request Authorization header.
 */
export async function authenticateClientRequest(request: Request): Promise<ClientJWTPayload | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  return verifyClientToken(token);
}
