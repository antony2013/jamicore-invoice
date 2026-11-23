import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { runPaymentReminders } from "@/lib/payment-reminder-runner";
import { handleRouteError } from "@/lib/http-errors";

/**
 * Sends due payment reminders. Call from a scheduler with
 * `x-cron-secret: <CRON_SECRET>`, or from the admin payment page with the
 * normal session cookie. Optional `?client=<uuid>` limits it to one client.
 */
async function handle(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const provided = request.headers.get("x-cron-secret");
    if (!secret || provided !== secret) {
      const me = await requireAdmin();
      if (me instanceof NextResponse) return me;
    }
    const clientId = new URL(request.url).searchParams.get("client")?.trim() || undefined;
    const sent = await runPaymentReminders(clientId);
    return NextResponse.json({ success: true, sent });
  } catch (error: any) {
    return handleRouteError(error, "cron/payment-reminders");
  }
}

export const GET = handle;
export const POST = handle;
