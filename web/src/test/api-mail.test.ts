import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { GET as listReports } from "@/app/api/reports/route";
import { DELETE as deleteReport } from "@/app/api/reports/[id]/route";
import { GET as listThreads } from "@/app/api/threads/route";
import { GET as listDrafts, POST as saveDraft } from "@/app/api/drafts/route";
import { DELETE as deleteDraft } from "@/app/api/drafts/[id]/route";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, auth: vi.fn() };
});
const mockAuth = vi.mocked(
  auth as unknown as (...args: never[]) => Promise<{
    user: { id: string; role: string; name: string };
  } | null>
);

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

async function seedReport(invoiceId: string, staffId: string, fileName = "report.xlsx") {
  const db = tdb();
  const { invoiceReports } = await import("@/db/schema");
  const [row] = await db
    .insert(invoiceReports)
    .values({ invoiceId, s3Key: `reports/${invoiceId}/${fileName}`, fileName, source: "uploaded", uploadedBy: staffId })
    .returning();
  return row;
}

async function seedMessage(
  invoiceId: string,
  sender: "staff" | "client",
  body: string,
  readByStaff = true
) {
  const db = tdb();
  const { invoiceMessages } = await import("@/db/schema");
  const [row] = await db
    .insert(invoiceMessages)
    .values({
      invoiceId,
      senderType: sender,
      senderId: sender === "staff" ? "staff-1" : "client-1",
      senderName: sender === "staff" ? "Staff" : "Client",
      kind: "text",
      body,
      isReadByStaff: sender === "staff" ? true : readByStaff,
      isReadByClient: sender === "staff" ? false : true,
    })
    .returning();
  return row;
}

describe("reports API", () => {
  it("admin lists current reports with invoice + client context", async () => {
    const admin = await seedStaff({ role: "admin" });
    const client = await seedClient();
    const inv = await seedInvoice(client.id, { status: "verified" });
    await seedReport(inv.id, admin.id, "monthly.xlsx");
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));

    const res: Response = await (listReports as any)(req("http://t/api/reports"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0]).toMatchObject({
      fileName: "monthly.xlsx",
      source: "uploaded",
    });
    expect(data.reports[0].invoice.id).toBe(inv.id);
    expect(data.reports[0].client.name).toBe(client.name);
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|pinHash/);
  });

  it("staff only sees reports on their own assigned invoices", async () => {
    const staff = await seedStaff();
    const other = await seedStaff();
    const client = await seedClient();
    const mine = await seedInvoice(client.id, { status: "verified", assignedTo: staff.id });
    const theirs = await seedInvoice(client.id, { status: "verified", assignedTo: other.id });
    await seedReport(mine.id, staff.id, "mine.xlsx");
    await seedReport(theirs.id, other.id, "theirs.xlsx");
    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const res: Response = await (listReports as any)(req("http://t/api/reports"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reports.map((r: { fileName: string }) => r.fileName)).toEqual(["mine.xlsx"]);
  });

  it("rejects an invalid client filter", async () => {
    const admin = await seedStaff({ role: "admin" });
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));
    const res: Response = await (listReports as any)(req("http://t/api/reports?client=nope"));
    expect(res.status).toBe(400);
  });

  it("admin deletes a report: row gone, audit written", async () => {
    const admin = await seedStaff({ role: "admin" });
    const client = await seedClient();
    const inv = await seedInvoice(client.id, { status: "verified" });
    const rep = await seedReport(inv.id, admin.id);
    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));

    const res: Response = await (deleteReport as any)(
      req(`http://t/api/reports/${rep.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: rep.id }) }
    );
    expect(res.status).toBe(200);

    const db = tdb();
    const { auditLog } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    expect(await db.query.invoiceReports.findMany({})).toHaveLength(0);
    const audits = await db.query.auditLog.findMany({ where: eq(auditLog.action, "report.delete") });
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(rep.id);
  });

  it("staff cannot delete a report on an invoice that is not theirs; missing report is 404", async () => {
    const admin = await seedStaff({ role: "admin" });
    const s = await seedStaff();
    const client = await seedClient();
    const inv = await seedInvoice(client.id, { status: "verified" });
    const rep = await seedReport(inv.id, admin.id);

    mockAuth.mockResolvedValue(officeSession({ id: s.id, role: "staff" }));
    const denied: Response = await (deleteReport as any)(
      req(`http://t/api/reports/${rep.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: rep.id }) }
    );
    // 404 (not 403) so staff cannot probe other people's reports.
    expect(denied.status).toBe(404);
    expect(await tdb().query.invoiceReports.findMany({})).toHaveLength(1);

    mockAuth.mockResolvedValue(officeSession({ id: admin.id, role: "admin" }));
    const missing: Response = await (deleteReport as any)(
      req("http://t/api/reports/00000000-0000-0000-0000-000000000000", { method: "DELETE" }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(missing.status).toBe(404);
  });

  it("assigned staff can delete their own report; row gone + audit written", async () => {
    const s = await seedStaff();
    const client = await seedClient();
    const inv = await seedInvoice(client.id, { status: "in_review", assignedTo: s.id });
    const rep = await seedReport(inv.id, s.id, "mine.xlsx");
    mockAuth.mockResolvedValue(officeSession({ id: s.id, role: "staff" }));

    const res: Response = await (deleteReport as any)(
      req(`http://t/api/reports/${rep.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: rep.id }) }
    );
    expect(res.status).toBe(200);

    const db = tdb();
    expect(await db.query.invoiceReports.findMany({})).toHaveLength(0);
    const { auditLog, invoices } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const audits = await db.query.auditLog.findMany({ where: eq(auditLog.action, "report.delete") });
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(rep.id);
    // The invoice itself is untouched.
    const still = await db.query.invoices.findFirst({ where: eq(invoices.id, inv.id) });
    expect(still?.id).toBe(inv.id);
  });
});

describe("threads API", () => {
  it("inbox holds client-latest threads only; answered threads live in sent", async () => {
    const a = await seedStaff();
    const b = await seedStaff();
    const client = await seedClient();
    const awaiting = await seedInvoice(client.id, { status: "needs_info", assignedTo: a.id });
    const answered = await seedInvoice(client.id, { status: "in_review", assignedTo: a.id });
    const theirs = await seedInvoice(client.id, { status: "needs_info", assignedTo: b.id });
    await seedMessage(awaiting.id, "client", "please fix this", false);
    await seedMessage(answered.id, "client", "hello?", false);
    await seedMessage(answered.id, "staff", "on it", true);
    await seedMessage(theirs.id, "client", "hello?", false);
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));

    const res: Response = await (listThreads as any)(req("http://t/api/threads"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // only the client-latest thread; the answered one is sent-only
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0]).toMatchObject({ invoiceId: awaiting.id, unread: 1 });
    expect(data.threads[0].lastBody).toBe("please fix this");
    expect(data.totalUnread).toBe(2);

    const sent: Response = await (listThreads as any)(req("http://t/api/threads?folder=sent"));
    const sentData = await sent.json();
    expect(sentData.threads).toHaveLength(1);
    expect(sentData.threads[0]).toMatchObject({ invoiceId: answered.id });
    expect(sentData.threads[0].lastSenderType).toBe("staff");
  });

  it("client-filtered inbox still hides threads we answered last", async () => {
    const a = await seedStaff();
    const client = await seedClient();
    const awaiting = await seedInvoice(client.id, { status: "needs_info", assignedTo: a.id });
    const answered = await seedInvoice(client.id, { status: "in_review", assignedTo: a.id });
    await seedMessage(awaiting.id, "client", "please fix this", false);
    await seedMessage(answered.id, "client", "hello?", false);
    await seedMessage(answered.id, "staff", "test", true);
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));

    const inbox: Response = await (listThreads as any)(
      req(`http://t/api/threads?folder=inbox&client=${client.id}`)
    );
    const inboxData = await inbox.json();
    expect(inboxData.threads.map((t: { invoiceId: string }) => t.invoiceId)).toEqual([awaiting.id]);

    const sent: Response = await (listThreads as any)(
      req(`http://t/api/threads?folder=sent&client=${client.id}`)
    );
    const sentData = await sent.json();
    expect(sentData.threads.map((t: { invoiceId: string }) => t.invoiceId)).toEqual([answered.id]);
  });

  it("rejects an invalid folder", async () => {
    const a = await seedStaff();
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));
    const res: Response = await (listThreads as any)(req("http://t/api/threads?folder=archived"));
    expect(res.status).toBe(400);
  });
});

describe("drafts API", () => {
  it("staff saves, lists, and deletes own draft; upsert keeps one row", async () => {
    const a = await seedStaff();
    const b = await seedStaff();
    const client = await seedClient();
    const mine = await seedInvoice(client.id, { status: "in_review", assignedTo: a.id });
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));

    const save = (body: unknown) =>
      (saveDraft as any)(req("http://t/api/drafts", { method: "POST", body }));
    expect((await save({ invoiceId: mine.id, body: "first" })).status).toBe(200);
    expect((await save({ invoiceId: mine.id, body: "second" })).status).toBe(200);

    const db = tdb();
    expect(await db.query.messageDrafts.findMany({})).toHaveLength(1);

    const listed: Response = await (listDrafts as any)(req("http://t/api/drafts"));
    const data = await listed.json();
    expect(data.drafts).toHaveLength(1);
    expect(data.drafts[0]).toMatchObject({ body: "second" });
    expect(data.drafts[0].client.name).toBe(client.name);

    // other staffer sees none of mine
    mockAuth.mockResolvedValue(officeSession({ id: b.id, role: "staff" }));
    const theirs: Response = await (listDrafts as any)(req("http://t/api/drafts"));
    expect((await theirs.json()).drafts).toHaveLength(0);

    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));
    const del: Response = await (deleteDraft as any)(
      req(`http://t/api/drafts/${data.drafts[0].id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: data.drafts[0].id }) }
    );
    expect(del.status).toBe(200);
    expect(await db.query.messageDrafts.findMany({})).toHaveLength(0);
  });

  it("staff cannot draft on someone else's invoice; empty body rejected", async () => {
    const a = await seedStaff();
    const b = await seedStaff();
    const client = await seedClient();
    const theirs = await seedInvoice(client.id, { status: "in_review", assignedTo: b.id });
    mockAuth.mockResolvedValue(officeSession({ id: a.id, role: "staff" }));

    const denied: Response = await (saveDraft as any)(
      req("http://t/api/drafts", { method: "POST", body: { invoiceId: theirs.id, body: "hi" } })
    );
    expect([403, 404]).toContain(denied.status);

    const empty: Response = await (saveDraft as any)(
      req("http://t/api/drafts", { method: "POST", body: { invoiceId: theirs.id, body: "  " } })
    );
    expect(empty.status).toBe(400);
  });
});
