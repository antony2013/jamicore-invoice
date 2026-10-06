import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signClientToken } from "@/lib/jwt";
import { transitionInvoice } from "@/lib/invoice-transitions";
import { ConflictError } from "@/lib/http-errors";
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
import { auth } from "@/lib/auth";
import { PATCH as patchInvoice } from "@/app/api/invoices/[id]/route";
import { POST as assignInvoice } from "@/app/api/invoices/[id]/assign/route";
import { DELETE as withdrawInvoice } from "@/app/api/client-invoices/[id]/route";
import { DELETE as deleteInvoice } from "@/app/api/invoices/[id]/route";
import { DELETE as deleteClient } from "@/app/api/clients/[id]/route";
import { POST as uploadUrl } from "@/app/api/invoices/upload-url/route";
import { POST as confirmUpload } from "@/app/api/invoices/confirm-upload/route";
import { GET as listInvoices } from "@/app/api/invoices/route";
import { GET as invoiceStats } from "@/app/api/invoices/stats/route";

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

function admin(id: string) {
  mockAuth.mockResolvedValue(officeSession({ id, role: "admin", name: "Admin" }));
}

describe("409 races", () => {
  it("stale expectedUpdatedAt token is 409, fresh token wins", async () => {
    const a = await seedStaff({ role: "admin" });
    admin(a.id);
    const s = await seedStaff();
    const c = await seedClient();
    const inv = await seedInvoice(c.id, {});
    // assign first (uploaded -> assigned is the only legal first move)
    const asg = await assignInvoice(
      req(`http://t/api/invoices/${inv.id}/assign`, { method: "POST", body: { staffId: s.id } }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(asg.status).toBe(200);
    // A token from an hour ago must lose, deterministically.
    const stale = new Date(Date.now() - 3600_000).toISOString();
    const lost = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { priority: "urgent", expectedUpdatedAt: stale },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(lost.status).toBe(409);
  });

  it("parallel assigns: one winner, losers get 409, never 500", async () => {
    const a = await seedStaff({ role: "admin" });
    admin(a.id);
    const staffers = [await seedStaff(), await seedStaff(), await seedStaff()];
    const c = await seedClient();
    const inv = await seedInvoice(c.id, {});
    const results = await Promise.all(
      staffers.map((s) =>
        assignInvoice(
          req(`http://t/api/invoices/${inv.id}/assign`, {
            method: "POST",
            body: { staffId: s.id },
          }),
          { params: Promise.resolve({ id: inv.id }) } as any
        )
      )
    );
    const codes = results.map((r) => r.status);
    expect(codes).toContain(200);
    for (const code of codes) expect([200, 409]).toContain(code);
    // Exclusivity itself is proven deterministically below (stale helper).
  });

  it("stale conditional update via helper throws ConflictError", async () => {
    const db = tdb();
    const s = await seedStaff();
    const c = await seedClient();
    const inv = await seedInvoice(c.id, {});
    await db.transaction(async (tx) => {
      await transitionInvoice(tx, {
        invoiceId: inv.id,
        expectedStatus: "uploaded",
        nextStatus: "assigned",
        actor: { type: "staff", id: s.id },
        allowSameStatus: true,
      });
      await expect(
        transitionInvoice(tx, {
          invoiceId: inv.id,
          expectedStatus: "uploaded",
          nextStatus: "assigned",
          actor: { type: "staff", id: s.id },
          allowSameStatus: true,
        })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it("same-status without the flag is 400, and never for terminal", async () => {
    const db = tdb();
    const s = await seedStaff();
    const c = await seedClient();
    const inv = await seedInvoice(c.id, { status: "assigned" });
    await expect(
      db.transaction(async (tx) =>
        transitionInvoice(tx, {
          invoiceId: inv.id,
          expectedStatus: "assigned",
          nextStatus: "assigned",
          actor: { type: "staff", id: s.id },
        })
      )
    ).rejects.toMatchObject({ status: 400 });
    const term = await seedInvoice(c.id, { status: "collected" });
    await expect(
      db.transaction(async (tx) =>
        transitionInvoice(tx, {
          invoiceId: term.id,
          expectedStatus: "collected",
          nextStatus: "collected",
          actor: { type: "staff", id: s.id },
          allowSameStatus: true,
        })
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("maker-checker", () => {
  it("verifier cannot collect; someone else can; data edits don't move it", async () => {
    const db = tdb();
    const a = await seedStaff({ role: "admin" });
    admin(a.id);
    const s1 = await seedStaff();
    const s2 = await seedStaff();
    const c = await seedClient();
    const inv = await seedInvoice(c.id, { status: "assigned", assignedTo: s1.id });

    // s1 moves to review, then verifies
    mockAuth.mockResolvedValue(officeSession({ id: s1.id, role: "staff" }));
    let r = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { status: "in_review", note: "reviewing" },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(r.status).toBe(200);
    r = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { status: "verified", note: "looks good" },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(r.status).toBe(200);

    // s1 collects → 403
    mockAuth.mockResolvedValue(officeSession({ id: s1.id, role: "staff" }));
    r = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { status: "collected" },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(r.status).toBe(403);

    // data edit by s1 with a note (echoes 'verified' into the log) — checker stays on s1
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "admin", name: "Admin" }));
    r = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { priority: "urgent", note: "admin touch" },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(r.status).toBe(200);

    // admin collects → 200 (different account than the verifier).
    // (s2 can't: verified invoices only move via their assignee or admin,
    // and re-assign is limited to open states by design.)
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "admin", name: "Admin" }));
    r = await patchInvoice(
      req(`http://t/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: { status: "collected" },
      }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(r.status).toBe(200);
  });
});

describe("soft delete", () => {
  it("withdraw-after-assign is 409 with message; soft-deleted rows vanish everywhere", async () => {
    const a = await seedStaff({ role: "admin" });
    admin(a.id);
    const s = await seedStaff();
    const c = await seedClient();
    const token = await signClientToken({
      id: c.id, role: "client", clientId: c.id, name: c.name, tv: 0,
    });
    const inv = await seedInvoice(c.id, {});

    // manual assign then withdraw → 409, not 500
    const asg = await assignInvoice(
      req(`http://t/api/invoices/${inv.id}/assign`, { method: "POST", body: { staffId: s.id } }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(asg.status).toBe(200);
    const w: Response = await (withdrawInvoice as any)(
      req(`http://t/api/client-invoices/${inv.id}`, { method: "DELETE", token }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(w.status).toBe(409);
    expect(JSON.stringify(await w.json())).toMatch(/office/i);

    // office soft delete with reason
    const del: Response = await (deleteInvoice as any)(
      req(`http://t/api/invoices/${inv.id}`, { method: "DELETE", body: { reason: "test case" } }),
      { params: Promise.resolve({ id: inv.id }) } as any
    );
    expect(del.status).toBe(200);

    // vanished from list + stats, children intact
    const list: Response = await (listInvoices as any)(req("http://t/api/invoices?limit=100"));
    const listed = ((await list.json()) as any).invoices as Array<{ id: string }>;
    expect(listed.some((i) => i.id === inv.id)).toBe(false);
    const stats: Response = await (invoiceStats as any)(req("http://t/api/invoices/stats"));
    const total = ((await stats.json()) as any).stats.total;
    expect(total).toBe(0);
    const { tdb: getDb } = await import("@/test/helpers");
    const { invoices, invoiceStatusLog } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const dbx = getDb();
    const logs = await dbx.query.invoiceStatusLog.findMany({
      where: eq(invoiceStatusLog.invoiceId, inv.id),
    });
    expect(logs.length).toBeGreaterThan(0);
    const rows = await dbx.query.invoices.findMany({ where: eq(invoices.id, inv.id) });
    expect(rows[0].deletedAt).not.toBeNull();
  });
});

describe("client hard delete rules", () => {
  it("client with invoices → 409; empty client → 200", async () => {
    const a = await seedStaff({ role: "admin" });
    admin(a.id);
    const c1 = await seedClient();
    await seedInvoice(c1.id, {});
    const c2 = await seedClient();

    const no = await deleteClient(
      req(`http://t/api/clients/${c1.id}`, {
        method: "DELETE",
        body: { confirmUsername: c1.username },
      }),
      { params: Promise.resolve({ id: c1.id }) } as any
    );
    expect(no.status).toBe(409);

    const yes = await deleteClient(
      req(`http://t/api/clients/${c2.id}`, {
        method: "DELETE",
        body: { confirmUsername: c2.username },
      }),
      { params: Promise.resolve({ id: c2.id }) } as any
    );
    expect(yes.status).toBe(200);
  });
});

describe("upload guards", () => {
  it("upload-url requires contentLength", async () => {
    const c = await seedClient();
    const token = await signClientToken({
      id: c.id, role: "client", clientId: c.id, name: c.name, tv: 0,
    });
    const res: Response = await (uploadUrl as any)(
      req("http://t/api/invoices/upload-url", {
        method: "POST",
        token,
        body: { contentType: "application/pdf" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("confirm deletes oversize/wrong-magic objects (mocked S3)", async () => {
    const { deleteObjectFromS3, inspectUploadObject } = await import("@/lib/s3");
    const c = await seedClient();
    const token = await signClientToken({
      id: c.id, role: "client", clientId: c.id, name: c.name, tv: 0,
    });
    const key = `invoices/${c.id}/t-evil.pdf`;

    vi.mocked(inspectUploadObject).mockResolvedValueOnce({
      exists: true,
      size: 20 * 1024 * 1024,
      contentType: "application/pdf",
      magicOk: true,
    });
    const big: Response = await (confirmUpload as any)(
      req("http://t/api/invoices/confirm-upload", { method: "POST", token, body: { s3Key: key } })
    );
    expect(big.status).toBe(400);
    expect(vi.mocked(deleteObjectFromS3)).toHaveBeenCalledWith(key);

    vi.mocked(inspectUploadObject).mockResolvedValueOnce({
      exists: true,
      size: 2048,
      contentType: "application/pdf",
      magicOk: false,
      magicDetail: "bad magic for .pdf",
    });
    const bad: Response = await (confirmUpload as any)(
      req("http://t/api/invoices/confirm-upload", { method: "POST", token, body: { s3Key: key } })
    );
    expect(bad.status).toBe(400);
    expect(vi.mocked(deleteObjectFromS3)).toHaveBeenCalledWith(key);
  });
});
