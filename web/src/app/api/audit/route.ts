import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { decodeCursor, encodeCursor } from "@/lib/cursor";

/**
 * Read-only audit trail (admin only). Keyset pages over `at DESC, id DESC`:
 * limit (default 50, max 100), cursor -> nextCursor. Filters: entity
 * (entity_type), entityId, actor (actor_type), actorId, action (prefix),
 * from, to (ISO dates on `at`).
 */
export async function GET(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { searchParams } = new URL(request.url);
    const get = (k: string) => {
      const v = searchParams.get(k)?.trim();
      return v ? v : undefined;
    };
    const entity = get("entity");
    const entityId = get("entityId");
    const actor = get("actor");
    const actorId = get("actorId");
    const action = get("action");
    const from = get("from");
    const to = get("to");
    if (from && Number.isNaN(Date.parse(from))) {
      return NextResponse.json({ error: "Invalid from date." }, { status: 400 });
    }
    if (to && Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: "Invalid to date." }, { status: 400 });
    }

    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 100);
    const cursorRaw = searchParams.get("cursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }

    const conditions = [];
    if (entity) conditions.push(eq(auditLog.entityType, entity));
    if (entityId) conditions.push(eq(auditLog.entityId, entityId));
    if (actor) conditions.push(eq(auditLog.actorType, actor));
    if (actorId) conditions.push(eq(auditLog.actorId, actorId));
    if (action) conditions.push(sql`${auditLog.action} ILIKE ${action + "%"}`);
    if (from) conditions.push(sql`${auditLog.at} >= ${from}::timestamptz`);
    if (to) conditions.push(sql`${auditLog.at} <= ${to}::timestamptz`);
    if (cursor) {
      conditions.push(
        sql`(${auditLog.at}, ${auditLog.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      );
    }

    const rows = await db.query.auditLog.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(auditLog.at), desc(auditLog.id)],
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor(last.at as unknown as Date, last.id)
        : null;

    return NextResponse.json({ success: true, entries: page, nextCursor });
  } catch (error: any) {
    console.error("Error in GET /api/audit:", error);
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }
}
