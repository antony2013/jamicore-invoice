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

export interface ClientJWTPayload {
  sub: string; // Client ID
  username?: string | null; // Client login ID (admin-created)
  phone?: string | null;
  email?: string | null;
  name: string; // Client Name
  role: "client";
}

/**
 * Sign and issue a JWT token for an authenticated mobile client.
 * Expiration: 7 days (reduced from 30d to bound leaked-token impact).
 */
export async function signClientToken(payload: {
  id: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  name: string;
}): Promise<string> {
  return new SignJWT({
    sub: payload.id,
    username: payload.username ?? undefined,
    phone: payload.phone ?? undefined,
    email: payload.email ?? undefined,
    name: payload.name,
    role: "client",
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

    if (payload.role !== "client" || !payload.sub || typeof payload.sub !== "string") {
      return null;
    }

    return {
      sub: payload.sub,
      username: (payload.username as string | undefined) ?? null,
      phone: (payload.phone as string | undefined) ?? null,
      email: (payload.email as string | undefined) ?? null,
      name: (payload.name as string) || "",
      role: "client",
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
