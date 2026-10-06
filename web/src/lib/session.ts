import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export type OfficeSession = {
  id: string;
  role: string;
  name: string;
  email?: string;
};

/**
 * Typed office-session guards. Returns the session user, or a NextResponse
 * (401/403) that the route must return directly:
 *
 *   const me = await requireOffice();
 *   if (me instanceof NextResponse) return me;
 */
export async function requireOffice(): Promise<OfficeSession | NextResponse> {
  const session = await auth();
  const user = session?.user as unknown as
    | { id?: unknown; role?: unknown; name?: unknown; email?: unknown }
    | undefined;
  if (!user || typeof user.id !== "string" || typeof user.role !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return {
    id: user.id,
    role: user.role,
    name: typeof user.name === "string" ? user.name : "",
    email: typeof user.email === "string" ? user.email : undefined,
  };
}

export async function requireAdmin(): Promise<OfficeSession | NextResponse> {
  const me = await requireOffice();
  if (me instanceof NextResponse) return me;
  if (me.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
  }
  return me;
}
