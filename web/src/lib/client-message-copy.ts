import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffMessages } from "@/db/schema";

const MAX_COPY_BODY = 4000;

/**
 * Staff → client messages also land in every active admin's inbox as a copy.
 * Admin sends never create a copy: the admin already sees the client message.
 * The copy stays in the staff mailbox (source="client_copy") so it is never
 * confused with a direct office note.
 */
export async function copyClientMessageToAdmins(input: {
  senderId: string;
  clientId: string;
  clientName: string;
  body: string;
  /** Invoice number or other short reference shown in the copy header. */
  reference?: string | null;
  /** Reuse the sender's batch so one send stays one thread group. */
  batchId?: string;
}): Promise<number> {
  const admins = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.role, "admin"), eq(staff.isActive, true)));
  const recipients = admins.filter((a) => a.id !== input.senderId);
  if (recipients.length === 0) return 0;

  const header = input.reference
    ? `Client message · ${input.clientName} · ${input.reference}`
    : `Client message · ${input.clientName}`;
  const body = `${header}\n${input.body}`.slice(0, MAX_COPY_BODY);
  const batchId = input.batchId || crypto.randomUUID();

  await db.insert(staffMessages).values(
    recipients.map((r) => ({
      senderId: input.senderId,
      recipientId: r.id,
      body,
      batchId,
      source: "client_copy",
      clientId: input.clientId,
    }))
  );
  return recipients.length;
}
