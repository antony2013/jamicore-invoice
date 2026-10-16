import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { writeAudit, getClientIp } from "@/lib/audit";
import {
  BACKUP_COOKIE,
  SESSION_MAX_AGE,
  cookieFlags,
  mintStaffToken,
  readBackupToken,
  readSessionToken,
} from "@/lib/impersonation";

/**
 * Admin → view a staffer's own dashboard without their credentials.
 * Swaps the admin session JWT for a staff-scoped one (audited); the
 * original admin JWT is stashed in an httpOnly backup cookie so
 * stop-impersonate can restore it. Target must be an ACTIVE staff
 * (never another admin). The live jwt callback keeps re-validating
 * the staff row, so deactivation/revocation kills the view session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const target = await db.query.staff.findFirst({ where: eq(staff.id, id) });
    if (!target || target.role !== "staff") {
      return NextResponse.json(
        { error: "Can only impersonate an active staff account." },
        { status: 400 }
      );
    }
    if ((target as { isActive?: boolean }).isActive === false) {
      return NextResponse.json(
        { error: "Can only impersonate an active staff account." },
        { status: 400 }
      );
    }

    const current = readSessionToken(request);
    if (!current) {
      return NextResponse.json({ error: "No active session to suspend." }, { status: 401 });
    }

    const minted = await mintStaffToken({
      id: target.id,
      role: "staff",
      tokenVersion: (target as { tokenVersion?: number }).tokenVersion ?? 0,
      adminId: me.id,
      salt: current.name,
    });

    await writeAudit(db, {
      actor: { type: "staff", id: me.id },
      action: "staff.impersonate_start",
      entityType: "staff",
      entityId: target.id,
      ip: getClientIp(request),
    });

    const res = NextResponse.json({ success: true, redirect: "/staff/dashboard" });
    // Keep the ORIGINAL admin JWT (chain-safe: never overwrite an
    // existing backup, so stop always returns to the real admin).
    if (!readBackupToken(request)) {
      res.cookies.set(BACKUP_COOKIE, current.value, cookieFlags(current.secure, SESSION_MAX_AGE));
    }
    res.cookies.set(current.name, minted.value, cookieFlags(current.secure, SESSION_MAX_AGE));
    return res;
  } catch (error: any) {
    console.error("Error in POST /api/staff/[id]/impersonate:", error);
    return NextResponse.json({ error: "Failed to start staff view" }, { status: 500 });
  }
}
