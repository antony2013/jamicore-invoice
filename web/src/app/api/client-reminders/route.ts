import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientPaymentReminders } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { handleRouteError } from "@/lib/http-errors";

const saveSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  enabled: z.boolean(),
  daysBefore: z.number().int().min(1).max(365),
});

export async function GET(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;
    const clientId = new URL(request.url).searchParams.get("clientId")?.trim() || "";
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    const [row] = await db
      .select()
      .from(clientPaymentReminders)
      .where(eq(clientPaymentReminders.clientId, clientId))
      .limit(1);
    return NextResponse.json({
      success: true,
      reminder: row
        ? {
            enabled: row.enabled,
            daysBefore: row.daysBefore,
            lastSentKey: row.lastSentKey,
          }
        : null,
    });
  } catch (error: any) {
    return handleRouteError(error, "GET /api/client-reminders");
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid reminder settings." },
        { status: 400 }
      );
    }
    const { clientId, enabled, daysBefore } = parsed.data;
    const now = new Date();
    await db
      .insert(clientPaymentReminders)
      .values({ clientId, enabled, daysBefore, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: clientPaymentReminders.clientId,
        set: { enabled, daysBefore, updatedAt: now },
      });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleRouteError(error, "POST /api/client-reminders");
  }
}
