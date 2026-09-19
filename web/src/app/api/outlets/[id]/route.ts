import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { invoices, outlets } from "@/db/schema";
import { auth } from "@/lib/auth";

const updateOutletSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone must be E.164 format")
    .nullable()
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const result = updateOutletSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const current = await db.query.outlets.findFirst({ where: eq(outlets.id, id) });
    if (!current) {
      return NextResponse.json({ error: "Outlet not found." }, { status: 404 });
    }

    const { name, address, phone } = result.data;
    if (name && name.trim() !== current.name) {
      const dup = await db.query.outlets.findFirst({
        where: and(
          eq(outlets.clientId, current.clientId),
          eq(outlets.name, name.trim()),
          ne(outlets.id, id)
        ),
      });
      if (dup) {
        return NextResponse.json(
          { error: "This client already has an outlet with this name." },
          { status: 409 }
        );
      }
    }

    const [updated] = await db
      .update(outlets)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(address !== undefined ? { address: address?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone ?? null } : {}),
      })
      .where(eq(outlets.id, id))
      .returning();

    return NextResponse.json({ success: true, outlet: updated });
  } catch (error: any) {
    console.error("Error updating outlet:", error);
    return NextResponse.json({ error: "Failed to update outlet" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const inUse = await db.query.invoices.findFirst({ where: eq(invoices.outletId, id) });
    if (inUse) {
      return NextResponse.json(
        { error: "Cannot delete: invoices are linked to this outlet. Reassign them first." },
        { status: 409 }
      );
    }

    await db.delete(outlets).where(eq(outlets.id, id));
    return NextResponse.json({ success: true, message: "Outlet deleted." });
  } catch (error: any) {
    console.error("Error deleting outlet:", error);
    return NextResponse.json({ error: "Failed to delete outlet" }, { status: 500 });
  }
}
