import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientRecords, clients } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { writeAudit, getClientIp } from "@/lib/audit";
import { CLIENT_RECORD_STATUSES, CLIENT_RECORD_TYPES } from "@/lib/client-records";
import { handleRouteError } from "@/lib/http-errors";

const createRecordSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  type: z.enum(CLIENT_RECORD_TYPES),
  title: z.string().trim().min(1, "Title is required").max(200),
  amount: z.coerce.number().min(0).max(999_999_999).optional(),
  recordDate: z.string().trim().max(10).nullable().optional(),
  status: z.enum(CLIENT_RECORD_STATUSES).optional(),
  assignedTo: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  // Work Details line-item fields (service records).
  workCategory: z.string().trim().max(100).nullable().optional(),
  quantity: z.coerce.number().min(0).max(999_999).optional(),
  rate: z.coerce.number().min(0).max(999_999_999).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");

    const filters = [];
    if (clientId) filters.push(eq(clientRecords.clientId, clientId));
    if (type && (CLIENT_RECORD_TYPES as readonly string[]).includes(type)) {
      filters.push(eq(clientRecords.type, type));
    }
    if (status && (CLIENT_RECORD_STATUSES as readonly string[]).includes(status)) {
      filters.push(eq(clientRecords.status, status));
    }

    const rows = await db.query.clientRecords.findMany({
      where: filters.length ? and(...filters) : undefined,
      orderBy: [desc(clientRecords.createdAt)],
    });

    return NextResponse.json({ success: true, records: rows });
  } catch (error: any) {
    console.error("Error fetching client records:", error);
    return NextResponse.json({ error: "Failed to fetch client records" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const body = await request.json();
    const result = createRecordSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      clientId,
      type,
      title,
      amount,
      recordDate,
      status,
      assignedTo,
      description,
      workCategory,
      quantity,
      rate,
      discountPercent,
      taxPercent,
    } = result.data;
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(clientRecords)
        .values({
          clientId,
          type,
          title,
          amount: String(amount ?? 0),
          recordDate: recordDate || null,
          ...(status ? { status } : {}),
          assignedTo: assignedTo || null,
          description: description || null,
          workCategory: workCategory || null,
          quantity: String(quantity ?? 0),
          rate: String(rate ?? 0),
          discountPercent: String(discountPercent ?? 0),
          taxPercent: String(taxPercent ?? 5),
          createdById: me.id,
        })
        .returning();
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "client.record_create",
        entityType: "client",
        entityId: clientId,
        after: { id: row.id, type, title },
        ip: getClientIp(request),
      });
      return [row];
    });

    return NextResponse.json({ success: true, record: created }, { status: 201 });
  } catch (error: any) {
    return handleRouteError(error, "POST /api/client-records");
  }
}
