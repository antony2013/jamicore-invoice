import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { safeStaff } from "@/lib/safe-columns";
import { writeAudit, getClientIp } from "@/lib/audit";
import { touchPresence } from "@/lib/presence";
import {
  BILLING_TYPES,
  BUSINESS_TYPES,
  CLIENT_STATUSES,
  PRIMARY_SERVICES,
} from "@/lib/client-profile";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{7,15}$/, "Phone must be E.164 format, e.g. +18765550123");

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "User ID must be at least 3 characters")
  .max(50)
  .regex(/^[a-z0-9._-]+$/, "User ID may contain letters, numbers, dots, underscores and hyphens");

// Client management profile vocabularies (shared with the edit API).
const createClientSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    username: usernameSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    phone: phoneSchema.optional(),
    email: z.string().email("Invalid email address").toLowerCase().trim().optional(),
    address: z.string().trim().max(500, "Address is too long").optional(),
    contactPerson: z.string().trim().max(100).optional(),
    businessType: z.enum(BUSINESS_TYPES).optional(),
    registrationNumber: z.string().trim().max(100).optional(),
    primaryService: z.enum(PRIMARY_SERVICES).optional(),
    serviceStartDate: z.string().trim().max(10).optional(),
    status: z.enum(CLIENT_STATUSES).optional(),
    billingType: z.enum(BILLING_TYPES).optional(),
    baseFee: z.coerce.number().min(0).max(999_999_999).optional(),
    paymentTerms: z.string().trim().max(100).optional(),
    extraWorkAllowed: z.boolean().optional(),
    internalNotes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.phone || d.email, {
    message: "Either phone (E.164) or email is required",
  });

function toPublicClient(c: typeof clients.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    username: (c as { username?: string | null }).username ?? null,
    phone: (c as { phone?: string | null }).phone ?? null,
    email: (c as { email?: string | null }).email ?? null,
    address: (c as { address?: string | null }).address ?? null,
    contactPerson: c.contactPerson,
    businessType: c.businessType,
    registrationNumber: c.registrationNumber,
    primaryService: c.primaryService,
    serviceStartDate: c.serviceStartDate,
    status: c.status,
    billingType: c.billingType,
    baseFee: c.baseFee,
    paymentTerms: c.paymentTerms,
    extraWorkAllowed: c.extraWorkAllowed,
    internalNotes: c.internalNotes,
    createdAt: c.createdAt,
  };
}

export async function GET() {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const clientList = await db.query.clients.findMany({
      with: {
        invoices: true,
        assignedStaff: safeStaff,
      },
      orderBy: [desc(clients.createdAt)],
    });

    const formatted = clientList.map((c) => ({
      id: c.id,
      name: c.name,
      username: (c as { username?: string | null }).username ?? null,
      phone: (c as { phone?: string | null }).phone ?? null,
      email: (c as { email?: string | null }).email ?? null,
      address: (c as { address?: string | null }).address ?? null,
      contactPerson: c.contactPerson,
      businessType: c.businessType,
      registrationNumber: c.registrationNumber,
      primaryService: c.primaryService,
      serviceStartDate: c.serviceStartDate,
      status: c.status,
      billingType: c.billingType,
      baseFee: c.baseFee,
      paymentTerms: c.paymentTerms,
      extraWorkAllowed: c.extraWorkAllowed,
      internalNotes: c.internalNotes,
      assignedStaffId: (c as { assignedStaffId?: string | null }).assignedStaffId ?? null,
      assignedStaffName: (c as any).assignedStaff?.name ?? null,
      archivedAt: (c as { archivedAt?: Date | null }).archivedAt ?? null,
      createdAt: c.createdAt,
      totalInvoices: c.invoices.length,
    }));

    return NextResponse.json({
      success: true,
      clients: formatted,
    });
  } catch (error: any) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const body = await request.json();
    const result = createClientSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      name,
      username,
      password,
      phone,
      email,
      address,
      contactPerson,
      businessType,
      registrationNumber,
      primaryService,
      serviceStartDate,
      status,
      billingType,
      baseFee,
      paymentTerms,
      extraWorkAllowed,
      internalNotes,
    } = result.data;

    // Duplicate check on username, phone and/or email.
    // Usernames must ALSO be unique across team staff (single login field).
    const dupConditions = [eq(clients.username, username)];
    if (phone) dupConditions.push(eq(clients.phone, phone));
    if (email) dupConditions.push(eq(clients.email, email));
    const [existing, staffDup] = await Promise.all([
      db.query.clients.findFirst({ where: or(...dupConditions) }),
      db.query.clientStaff.findFirst({ where: eq(clientStaff.username, username) }),
    ]);
    if (existing || staffDup) {
      return NextResponse.json(
        { error: "A client with this user ID, phone number or email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(clients)
        .values({
          name: name.trim(),
          username,
          passwordHash,
          phone: phone ?? null,
          email: email ?? null,
          address: address || null,
          contactPerson: contactPerson || null,
          ...(businessType ? { businessType } : {}),
          registrationNumber: registrationNumber || null,
          ...(primaryService ? { primaryService } : {}),
          serviceStartDate: serviceStartDate || null,
          ...(status ? { status } : {}),
          ...(billingType ? { billingType } : {}),
          ...(baseFee !== undefined ? { baseFee: String(baseFee) } : {}),
          paymentTerms: paymentTerms || null,
          ...(extraWorkAllowed !== undefined ? { extraWorkAllowed } : {}),
          internalNotes: internalNotes || null,
        })
        .returning();
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "client.create",
        entityType: "client",
        entityId: row.id,
        after: { name: row.name, username },
        ip: getClientIp(request),
      });
      return [row];
    });

    return NextResponse.json(
      {
        success: true,
        message: `Client "${created.name}" created with user ID "${username}". Share these credentials with the client.`,
        client: toPublicClient(created),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating client:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
