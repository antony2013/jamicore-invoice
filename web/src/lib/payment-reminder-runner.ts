import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clientMessages,
  clientPaymentReminders,
  clientRecords,
  clients,
} from "@/db/schema";
import { computeDueDate, dateKey } from "@/lib/payment-due";

function money(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} KWD`;
}

/**
 * Sends an automatic payment reminder to each opted-in client once their
 * "days before due date" threshold is reached. The due date comes from the
 * newest work item plus that client's payment terms. Safe to run repeatedly:
 * lastSentKey prevents a second send for the same due date.
 */
export async function runPaymentReminders(clientId?: string) {
  const configs = await db.query.clientPaymentReminders.findMany({
    where: clientId
      ? and(
          eq(clientPaymentReminders.clientId, clientId),
          eq(clientPaymentReminders.enabled, true)
        )
      : eq(clientPaymentReminders.enabled, true),
  });

  const sent: Array<{ clientId: string; dueDate: string; balance: number }> = [];

  for (const config of configs) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, config.clientId),
      columns: { id: true, name: true, paymentTerms: true, archivedAt: true },
    });
    if (!client || client.archivedAt) continue;

    const records = await db.query.clientRecords.findMany({
      where: eq(clientRecords.clientId, config.clientId),
      orderBy: [desc(clientRecords.createdAt)],
    });
    const work = records.find(
      (r) => r.type === "service" && r.status !== "cancelled"
    );
    if (!work) continue;

    const due = computeDueDate(work.recordDate, work.createdAt, client.paymentTerms);
    if (!due) continue;
    const dueKey = dateKey(due);
    if (config.lastSentKey === dueKey) continue;

    const reminderDay = dateKey(
      new Date(due.getTime() - config.daysBefore * 86_400_000)
    );
    if (dateKey(new Date()) < reminderDay) continue;

    const grandTotal = records
      .filter((r) => r.type === "service" && r.status !== "cancelled")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const amountPaid = records
      .filter((r) => r.type === "payment" && r.status === "paid")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const balance = Math.max(0, grandTotal - amountPaid);
    if (balance <= 0) continue;

    const body =
      `Payment reminder for ${client.name}: balance ${money(balance)} is due on ${dueKey}. ` +
      `Grand Total ${money(grandTotal)} · Amount Paid ${money(amountPaid)}.`;

    await db.transaction(async (tx) => {
      await tx.insert(clientMessages).values({
        clientId: config.clientId,
        senderType: "staff",
        senderId: "system",
        senderName: "JamiCore Auto Reminder",
        body,
        isReadByStaff: true,
        isReadByClient: false,
      });
      await tx.insert(clientRecords).values({
        clientId: config.clientId,
        type: "notification",
        title: "Auto payment reminder sent",
        amount: String(Number(balance.toFixed(3))),
        status: "completed",
        description: body,
        createdById: "system",
      });
      await tx
        .update(clientPaymentReminders)
        .set({ lastSentKey: dueKey, updatedAt: new Date() })
        .where(eq(clientPaymentReminders.id, config.id));
    });

    sent.push({ clientId: config.clientId, dueDate: dueKey, balance });
  }

  return sent;
}
