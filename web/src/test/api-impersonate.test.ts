import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decode } from "@auth/core/jwt";
import { auth } from "@/lib/auth";
import {
  closeTestDb,
  migrateTestDb,
  officeSession,
  req,
  seedClient,
  seedInvoice,
  seedStaff,
  tdb,
  truncateAll,
} from "@/test/helpers";
import { POST as startImpersonate } from "@/app/api/staff/[id]/impersonate/route";
import { POST as stopImpersonate } from "@/app/api/staff/stop-impersonate/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, auth: vi.fn() };
});
const mockAuth = vi.mocked(
  auth as unknown as (...args: never[]) => Promise<{
    user: { id: string; role: string; name: string };
  } | null>
);

const SECRET = "test-only-nextauth-secret-not-a-real-secret";
const SESSION_COOKIE = "authjs.session-token";

function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

function setCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
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

describe("staff impersonation", () => {
  it("admin starts a staff view: staff JWT set, admin JWT backed up, audited", async () => {
    const admin = await seedStaff({ role: "admin" });
    const staff = await seedStaff();
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));

    const res: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${staff.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader("admin-jwt-placeholder"),
      }),
      { params: Promise.resolve({ id: staff.id }) }
    );
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies[SESSION_COOKIE]).toBeTruthy();
    expect(cookies["impersonate_backup"]).toBe("admin-jwt-placeholder");

    const decoded = (await decode({
      token: cookies[SESSION_COOKIE],
      secret: SECRET,
      salt: SESSION_COOKIE,
    })) as any;
    expect(decoded).toMatchObject({
      id: staff.id,
      role: "staff",
      impersonatedBy: admin.id,
    });

    const db = tdb();
    const { auditLog } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const audits = await db.query.auditLog.findMany({
      where: eq(auditLog.action, "staff.impersonate_start"),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(staff.id);
  });

  it("staff cannot impersonate; inactive and admin targets rejected", async () => {
    const admin = await seedStaff({ role: "admin" });
    const s = await seedStaff();
    const dead = await seedStaff();
    const db = tdb();
    const { staff } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(staff).set({ isActive: false }).where(eq(staff.id, dead.id));

    mockAuth.mockResolvedValue(officeSession({ id: s.id, role: "staff" }));
    const denied: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${admin.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader("x"),
      }),
      { params: Promise.resolve({ id: admin.id }) }
    );
    expect(denied.status).toBe(403);

    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));
    const deadRes: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${dead.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader("x"),
      }),
      { params: Promise.resolve({ id: dead.id }) }
    );
    expect(deadRes.status).toBe(400);

    const adminTarget: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${admin.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader("x"),
      }),
      { params: Promise.resolve({ id: admin.id }) }
    );
    expect(adminTarget.status).toBe(400);
  });

  it("stop restores the admin session and audits; missing backup is 400", async () => {
    const admin = await seedStaff({ role: "admin" });
    const staff = await seedStaff();
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));

    // full round trip: start, then stop with both cookies
    const started: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${staff.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader("admin-jwt-placeholder"),
      }),
      { params: Promise.resolve({ id: staff.id }) }
    );
    const startedCookies = setCookies(started);

    // now acting as the staffer, with the backup cookie present
    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));
    const stopped: Response = await (stopImpersonate as any)(
      req("http://t/api/staff/stop-impersonate", {
        method: "POST",
        cookie: `${SESSION_COOKIE}=${startedCookies[SESSION_COOKIE]}; impersonate_backup=${startedCookies["impersonate_backup"]}`,
      })
    );
    // backup was a placeholder, not a real admin JWT → 401, admin untouched
    expect(stopped.status).toBe(401);

    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));
    const noBackup: Response = await (stopImpersonate as any)(
      req("http://t/api/staff/stop-impersonate", {
        method: "POST",
        cookie: sessionCookieHeader("whatever"),
      })
    );
    expect(noBackup.status).toBe(400);
  });

  it("impersonated staff session still sees only own invoices", async () => {
    const admin = await seedStaff({ role: "admin" });
    const staff = await seedStaff();
    const other = await seedStaff();
    const client = await seedClient();
    const mine = await seedInvoice(client.id, { status: "assigned", assignedTo: staff.id });
    await seedInvoice(client.id, { status: "assigned", assignedTo: other.id });

    // build a REAL admin JWT (not a placeholder) so stop-impersonate can verify it
    const { encode } = await import("@auth/core/jwt");
    const { staff: staffTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = tdb();
    const [adminRow] = await db.select().from(staffTable).where(eq(staffTable.id, admin.id));
    const adminJwt = await encode({
      secret: SECRET,
      salt: SESSION_COOKIE,
      maxAge: 12 * 60 * 60,
      token: {
        sub: adminRow.id,
        id: adminRow.id,
        role: "admin",
        tokenVersion: (adminRow as any).tokenVersion ?? 0,
      },
    });

    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));
    const started: Response = await (startImpersonate as any)(
      req(`http://t/api/staff/${staff.id}/impersonate`, {
        method: "POST",
        cookie: sessionCookieHeader(adminJwt),
      }),
      { params: Promise.resolve({ id: staff.id }) }
    );
    expect(started.status).toBe(200);
    const cookies = setCookies(started);

    // stop restores the real admin JWT byte-for-byte
    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));
    const stopped: Response = await (stopImpersonate as any)(
      req("http://t/api/staff/stop-impersonate", {
        method: "POST",
        cookie: `${SESSION_COOKIE}=${cookies[SESSION_COOKIE]}; impersonate_backup=${cookies["impersonate_backup"]}`,
      })
    );
    expect(stopped.status).toBe(200);
    expect(setCookies(stopped)[SESSION_COOKIE]).toBe(adminJwt);
    expect(mine.id).toBeTruthy();
  });
});
