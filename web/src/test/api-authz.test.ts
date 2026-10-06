import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  truncateAll,
} from "@/test/helpers";
import { GET as listInvoices } from "@/app/api/invoices/route";
import { GET as getInvoice } from "@/app/api/invoices/[id]/route";
import { GET as getHistory } from "@/app/api/history/route";
import { GET as listClients } from "@/app/api/clients/route";
import { GET as listOutlets } from "@/app/api/outlets/route";
import { GET as listClientInvoices } from "@/app/api/client-invoices/route";
import { GET as listTeam } from "@/app/api/client-team/route";
import { GET as listClientOutlets } from "@/app/api/client-outlets/route";
import { GET as listStaff } from "@/app/api/staff/route";
import { GET as listAudit } from "@/app/api/audit/route";
import { GET as officeMessages } from "@/app/api/invoices/[id]/messages/route";
import { GET as clientMessages } from "@/app/api/client-invoices/[id]/messages/route";
import { GET as officeReport } from "@/app/api/invoices/[id]/report/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, auth: vi.fn() };
});
const mockAuth = vi.mocked(auth as unknown as (...args: never[]) => Promise<{ user: { id: string; role: string; name: string } } | null>);

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

function adminSession(id: string) {
  mockAuth.mockResolvedValue(officeSession({ id, role: "admin", name: "Admin" }));
}

describe("authz: staff isolation", () => {
  it("staff B gets 404 on staff A's invoice", async () => {
    const a = await seedStaff();
    const b = await seedStaff();
    const c = await seedClient();
    const inv = await seedInvoice(c.id, { status: "assigned", assignedTo: a.id });
    mockAuth.mockResolvedValue(officeSession({ id: b.id, role: "staff" }));
    const res = await getInvoice(req(`http://t/api/invoices/${inv.id}`), {
      params: Promise.resolve({ id: inv.id }),
    } as any);
    expect(res.status).toBe(404);
  });

  it("staff cannot hit admin routes (403)", async () => {
    const s = await seedStaff();
    mockAuth.mockResolvedValue(officeSession({ id: s.id, role: "staff" }));
    const res: Response = await (listClients as any)();
    expect(res.status).toBe(403);
  });

  it("unauthenticated office calls get 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res: Response = await (listInvoices as any)();
    expect(res.status).toBe(401);
  });
});

describe("authz: client isolation", () => {
  it("client A cannot read/edit client B's invoice", async () => {
    const ca = await seedClient();
    const cb = await seedClient();
    const invB = await seedInvoice(cb.id, {});
    const { PATCH: patchInvoice } = await import("@/app/api/client-invoices/[id]/route");
    const tokenA = await signClientToken({
      id: ca.id, role: "client", clientId: ca.id, name: ca.name, tv: 0,
    });
    const get: Response = await (clientMessages as any)(
      req(`http://t/api/client-invoices/${invB.id}/messages`, { token: tokenA }),
      { params: Promise.resolve({ id: invB.id }) } as any
    );
    expect(get.status).toBe(404);
    const patch: Response = await (patchInvoice as any)(
      req(`http://t/api/client-invoices/${invB.id}`, {
        method: "PATCH", token: tokenA, body: { note: "hijack" },
      }),
      { params: Promise.resolve({ id: invB.id }) } as any
    );
    expect(patch.status).toBe(404);
  });

  it("team staff sees only own uploads", async () => {
    const c = await seedClient();
    const m1 = await seedMember(c.id);
    const m2 = await seedMember(c.id);
    await seedInvoice(c.id, { uploadedByStaffId: m1.id });
    await seedInvoice(c.id, { uploadedByStaffId: m2.id });
    const token = await signClientToken({
      id: m1.id, role: "client_staff", clientId: c.id,
      username: m1.username, name: m1.name, tv: 0,
    });
    const res = await listClientInvoices(req("http://t/api/client-invoices", { token }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.invoices).toHaveLength(1);
    assertNoSecrets(data);
  });

  it("revoked client token returns 401", async () => {
    const c = await seedClient();
    const { tdb } = await import("@/test/helpers");
    const { clients } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const token = await signClientToken({
      id: c.id, role: "client", clientId: c.id, name: c.name, tv: 0,
    });
    await tdb()
      .update(clients)
      .set({ tokenVersion: sql`token_version + 1` })
      .where(eq(clients.id, c.id));
    const res = await listClientInvoices(req("http://t/api/client-invoices", { token }));
    expect(res.status).toBe(401);
  });
});

describe("auth: staff session lifecycle (real callbacks)", () => {
  it("deactivated staff session is rejected on next request", async () => {
    const s = await seedStaff();
    const withSession = await (authOptions.callbacks as any).jwt({
      token: { id: s.id, role: "staff", tokenVersion: 0 },
      user: undefined,
    });
    expect(withSession).not.toBeNull();
    const { tdb } = await import("@/test/helpers");
    const { staff } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await tdb().update(staff).set({ isActive: false }).where(eq(staff.id, s.id));
    const dead = await (authOptions.callbacks as any).jwt({
      token: { id: s.id, role: "staff", tokenVersion: 0 },
      user: undefined,
    });
    expect(dead).toBeNull();
  });

  it("role refresh follows the DB row", async () => {
    const s = await seedStaff({ role: "staff" });
    const { tdb } = await import("@/test/helpers");
    const { staff } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await tdb().update(staff).set({ role: "admin" }).where(eq(staff.id, s.id));
    const token = await (authOptions.callbacks as any).jwt({
      token: { id: s.id, role: "staff", tokenVersion: 0 },
      user: undefined,
    });
    expect(token.role).toBe("admin");
  });
});

describe("no secrets in GET responses", () => {
  it("every office/client GET handler is hash-free", async () => {
    const admin = await seedStaff({ role: "admin" });
    adminSession(admin.id);
    const c = await seedClient();
    const inv = await seedInvoice(c.id, { status: "assigned", assignedTo: admin.id });
    const adminToken = await signClientToken({
      id: c.id, role: "client", clientId: c.id, name: c.name, tv: 0,
    });

    const calls: Array<[string, Promise<any>]> = [
      ["listInvoices", (listInvoices as any)(req("http://t/api/invoices"))],
      ["getInvoice", getInvoice(req(`http://t/api/invoices/${inv.id}`), { params: Promise.resolve({ id: inv.id }) } as any)],
      ["history", getHistory(req("http://t/api/history"))],
      ["clients", (listClients as any)()],
      ["outlets", listOutlets(req("http://t/api/outlets"))],
      ["staff", (listStaff as any)()],
      ["audit", (listAudit as any)(req("http://t/api/audit"))],
      ["officeMessages", officeMessages(req(`http://t/api/invoices/${inv.id}/messages`), { params: Promise.resolve({ id: inv.id }) } as any)],
      ["officeReport", officeReport(req(`http://t/api/invoices/${inv.id}/report`), { params: Promise.resolve({ id: inv.id }) } as any)],
      ["clientInvoices", listClientInvoices(req("http://t/api/client-invoices", { token: adminToken }))],
      ["clientTeam", listTeam(req("http://t/api/client-team", { token: adminToken }))],
      ["clientOutlets", listClientOutlets(req("http://t/api/client-outlets", { token: adminToken }))],
    ];
    for (const [name, p] of calls) {
      const res = await p;
      expect(res.status, name).toBe(200);
      assertNoSecrets(await res.json(), name);
    }
  });
});
