import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

/**
 * Test-only database wiring. Connects EXCLUSIVELY to DATABASE_URL_TEST
 * (the global setup already refused anything else). Never touches the
 * app's `db` singleton, so a misconfigured test cannot reach dev data.
 */
function testUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is unset (global setup should have refused first)");
  return url;
}

let client: ReturnType<typeof postgres> | null = null;

export function tdb() {
  if (!client) {
    client = postgres(testUrl(), { max: 5 });
  }
  return drizzle(client, { schema });
}

export async function migrateTestDb(): Promise<void> {
  const c = postgres(testUrl(), { max: 1 });
  const dbo = drizzle(c, { schema });
  await migrate(dbo, { migrationsFolder: "./src/db/migrations" });
  await c.end();
}

const TABLES = [
  "audit_log",
  "rate_limits",
  "invoice_messages",
  "invoice_reports",
  "invoice_status_log",
  "assignments",
  "invoices",
  "outlets",
  "client_staff",
  "clients",
  "staff",
] as const;

export async function truncateAll(): Promise<void> {
  const db = tdb();
  await db.execute(
    sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`)
  );
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}

let seq = 0;
const uniq = () => `${Date.now() % 100000}_${seq++}`;

export async function seedStaff(
  overrides: Partial<{ name: string; email: string; password: string; role: "admin" | "staff"; isActive: boolean }> = {}
) {
  const db = tdb();
  const email = overrides.email ?? `t-staff-${uniq()}@jamicore.com`;
  const [row] = await db
    .insert(schema.staff)
    .values({
      name: overrides.name ?? "Test Staff",
      email,
      role: overrides.role ?? "staff",
      passwordHash: await bcrypt.hash(overrides.password ?? "testpass123", 12),
      isActive: overrides.isActive ?? true,
    })
    .returning();
  return { ...row, _password: overrides.password ?? "testpass123" };
}

export async function seedClient(
  overrides: Partial<{ name: string; username: string; password: string }> = {}
) {
  const db = tdb();
  const username = overrides.username ?? `t.client.${uniq()}`;
  const [row] = await db
    .insert(schema.clients)
    .values({
      name: overrides.name ?? "Test Client",
      username,
      passwordHash: await bcrypt.hash(overrides.password ?? "testpass123", 12),
      phone: `+9198765432${String(seq).padStart(2, "0").slice(-2)}${String(Date.now() % 97).padStart(2, "0")}`,
    })
    .returning();
  return { ...row, _password: overrides.password ?? "testpass123" };
}

export async function seedMember(
  clientId: string,
  overrides: Partial<{ name: string; username: string; pin: string }> = {}
) {
  const db = tdb();
  const [row] = await db
    .insert(schema.clientStaff)
    .values({
      clientId,
      name: overrides.name ?? "Test Member",
      username: overrides.username ?? `t.member.${uniq()}`,
      pinHash: await bcrypt.hash(overrides.pin ?? "123456", 12),
    })
    .returning();
  return row;
}

export async function seedInvoice(
  clientId: string,
  overrides: Partial<{ status: string; assignedTo: string | null; s3Key: string; uploadedByStaffId: string | null }> = {}
) {
  const db = tdb();
  const key = overrides.s3Key ?? `invoices/${clientId}/t-${uniq()}.pdf`;
  const [row] = await db
    .insert(schema.invoices)
    .values({
      clientId,
      s3Key: key,
      imageUrl: key,
      status: (overrides.status ?? "uploaded") as any,
      assignedTo: overrides.assignedTo ?? null,
      uploadedByStaffId: overrides.uploadedByStaffId ?? null,
    })
    .returning();
  await db.insert(schema.invoiceStatusLog).values({
    invoiceId: row.id,
    status: (overrides.status ?? "uploaded") as any,
    note: "seed",
  });
  return row;
}

/** Build a Request for direct route-handler calls. */
export function req(
  url: string,
  init: { method?: string; token?: string; cookie?: string; body?: unknown } = {}
): Request {
  const headers: Record<string, string> = {};
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  if (init.cookie) headers["Cookie"] = init.cookie;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Mocked office session shape (used with vi.mock("@/lib/auth")). */
export function officeSession(user: { id: string; role: string; name?: string }) {
  return { user: { id: user.id, role: user.role, name: user.name ?? "Test" } };
}
