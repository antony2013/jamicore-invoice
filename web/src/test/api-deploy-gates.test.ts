import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { authOptions } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { signClientToken } from "@/lib/jwt";
import { assertNoSecrets } from "@/lib/safe-columns";
import {
  closeTestDb,
  migrateTestDb,
  officeSession,
  req,
  seedClient,
  seedInvoice,
  seedMember,
  seedStaff,
  tdb,
  truncateAll,
} from "@/test/helpers";
import { GET as listInvoices } from "@/app/api/invoices/route";
import { GET as getInvoice } from "@/app/api/invoices/[id]/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, auth: vi.fn() };
});
const mockAuth = vi.mocked(
  auth as unknown as (...args: never[]) => Promise<{
    user: { id: string; role: string; name: string };
  } | null>
);

function authorizeFn(): (credentials: unknown, req: unknown) => Promise<unknown> {
  const provider = ((authOptions.providers as unknown) as Array<Record<string, unknown>>)[0] ?? {};
  const fn =
    (provider.authorize as unknown) ?? (provider.options as Record<string, unknown> | undefined)?.authorize;
  if (typeof fn !== "function") throw new Error("authorize() not reachable on credentials provider");
  return fn as (credentials: unknown, req: unknown) => Promise<unknown>;
}

beforeAll(async () => {
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  mockAuth.mockReset();
});

afterAll(async () => {
  await closeTestDb();
});

describe("deploy gate (a): secrets as staff AND admin, full relations", () => {
  it("GET /api/invoices + /api/invoices/[id] are hash-free for both roles", async () => {
    const admin = await seedStaff({ role: "admin" });
    const staff = await seedStaff();
    const client = await seedClient(); // has passwordHash
    const member = await seedMember(client.id); // has pinHash
    const inv = await seedInvoice(client.id, {
      status: "assigned",
      assignedTo: staff.id,
      uploadedByStaffId: member.id,
    });
    // admin actor in the status log
    const db = tdb();
    const { invoiceStatusLog } = await import("@/db/schema");
    await db.insert(invoiceStatusLog).values({
      invoiceId: inv.id,
      status: "assigned",
      changedBy: admin.id,
      note: "seed assign",
    });

    for (const [role, id] of [["staff", staff.id], ["admin", admin.id]] as const) {
      mockAuth.mockReset();
      mockAuth.mockResolvedValue(officeSession({ id, role }));
      const list: Response = await (listInvoices as any)(req("http://t/api/invoices"));
      expect(list.status, `${role} list`).toBe(200);
      assertNoSecrets(await list.json(), `${role} list`);
      const one: Response = await (getInvoice as any)(
        req(`http://t/api/invoices/${inv.id}`),
        { params: Promise.resolve({ id: inv.id }) }
      );
      expect(one.status, `${role} detail`).toBe(200);
      assertNoSecrets(await one.json(), `${role} detail`);
    }
  });
});

describe("deploy gate (b): deactivated staff cannot log in", () => {
  it("authorize returns null for inactive accounts, user for active", async () => {
    const active = await seedStaff({ password: "rightpass123" });
    const dead = await seedStaff({ password: "rightpass123" });
    const { staff } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await tdb().update(staff).set({ isActive: false }).where(eq(staff.id, dead.id));

    const authorize = authorizeFn();
    const ok = await authorize(
      { email: active.email, password: "rightpass123" },
      { headers: { get: () => null } }
    );
    expect(ok).toMatchObject({ id: active.id });

    const no = await authorize(
      { email: dead.email, password: "rightpass123" },
      { headers: { get: () => null } }
    );
    expect(no).toBeNull();
  });
});

describe("deploy gate (c): archive + tv-less tokens die with 401", () => {
  it("archived client: old token 401, fresh login 401", async () => {
    const admin = await seedStaff({ role: "admin" });
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));
    const { PATCH: patchClient } = await import("@/app/api/clients/[id]/route");
    const { GET: listMine } = await import("@/app/api/client-invoices/route");
    const client = await seedClient();
    const token = await signClientToken({
      id: client.id, role: "client", clientId: client.id, name: client.name, tv: 0,
    });

    const arch: Response = await (patchClient as any)(
      req(`http://t/api/clients/${client.id}`, { method: "PATCH", body: { archived: true } }),
      { params: Promise.resolve({ id: client.id }) }
    );
    expect(arch.status).toBe(200);

    const old: Response = await (listMine as any)(
      req("http://t/api/client-invoices", { token })
    );
    expect(old.status).toBe(401);

    const { POST: login } = await import("@/app/api/client-auth/login/route");
    const fresh = await (login as any)(
      req("http://t/api/client-auth/login", {
        method: "POST",
        body: { username: client.username, password: "testpass123" },
      })
    );
    expect(fresh.status).toBe(401);
  });

  it("tokens without tv are rejected", async () => {
    const client = await seedClient();
    const { GET: listMine } = await import("@/app/api/client-invoices/route");
    // hand-rolled legacy token: valid signature, correct claims, NO tv
    const legacy = await new SignJWT({
      sub: client.id,
      role: "client",
      clientId: client.id,
      name: client.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("jamicore-invoice")
      .setAudience("jamicore-mobile")
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const res: Response = await (listMine as any)(
      req("http://t/api/client-invoices", { token: legacy })
    );
    expect(res.status).toBe(401);
  });
});

describe("deploy gate (d): staff login throttles after threshold", () => {
  it("10 wrong passwords then even the right one fails (flood-safe null)", async () => {
    const s = await seedStaff({ password: "rightpass123" });
    const authorize = authorizeFn();
    const attempt = (pw: string) =>
      authorize({ email: s.email, password: pw }, { headers: { get: () => null } });
    for (let i = 0; i < 10; i++) {
      expect(await attempt("wrong-wrong-wrong")).toBeNull();
    }
    // 11th: correct password, but the email bucket is spent → still null.
    expect(await attempt("rightpass123")).toBeNull();

    const { rateLimits } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await tdb().query.rateLimits.findMany({
      where: eq(rateLimits.key, `staff-login-email:${s.email}`),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBeGreaterThanOrEqual(10);
  });
});
