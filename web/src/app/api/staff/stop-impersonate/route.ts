import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { writeAudit, getClientIp } from "@/lib/audit";
import {
  BACKUP_COOKIE,
  cookieFlags,
  decodeToken,
  readBackupToken,
  readSessionToken,
} from "@/lib/impersonation";

/**
 * Exit a staff view started via impersonate: verifies the stashed
 * backup JWT is still a live admin session, then restores it.
 */
export async function POST(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const backup = readBackupToken(request);
    if (!backup) {
      return NextResponse.json(
        { error: "No suspended admin session to restore. Please sign in again." },
        { status: 400 }
      );
    }

    const current = readSessionToken(request);
    const salt = current?.name ?? "authjs.session-token";
    const decoded = await decodeToken(backup, salt);
    const adminId = typeof decoded?.id === "string" ? decoded.id : null;
    const row =
      adminId != null
        ? await db.query.staff.findFirst({ where: eq(staff.id, adminId) })
        : null;
    if (
      !row ||
      row.role !== "admin" ||
      (row as { isActive?: boolean }).isActive === false ||
      ((row as { tokenVersion?: number }).tokenVersion ?? 0) !==
        ((decoded?.tokenVersion as number | undefined) ?? 0) ||
      decoded?.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Suspended session is no longer valid. Please sign in again." },
        { status: 401 }
      );
    }

    await writeAudit(db, {
      actor: { type: "staff", id: row.id },
      action: "staff.impersonate_stop",
      entityType: "staff",
      entityId: me.id,
      ip: getClientIp(request),
    });

    const res = NextResponse.json({ success: true, redirect: "/admin/staff" });
    res.cookies.set(salt, backup, cookieFlags(salt.startsWith("__Secure"), 12 * 60 * 60));
    res.cookies.set(BACKUP_COOKIE, "", cookieFlags(salt.startsWith("__Secure"), 0));
    return res;
  } catch (error: any) {
    console.error("Error in POST /api/staff/stop-impersonate:", error);
    return NextResponse.json({ error: "Failed to exit staff view" }, { status: 500 });
  }
}
