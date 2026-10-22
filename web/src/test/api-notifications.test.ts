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
import { GET as getNotifications, POST as postNotifications } from "@/app/api/notifications/route";

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

async function seedMessage(invoiceId: string, body: string) {
  const db = tdb();
  const { invoiceMessages } = await import("@/db/schema");
  const [row] = await db
    .insert(invoiceMessages)
    .values({
      invoiceId,
      senderType: "client",
      senderId: "client-1",
      senderName: "Client",
      kind: "text",
      body,
      isReadByStaff: false,
      isReadByClient: true,
    })
    .returning();
  return row;
}

const url = "http://localhost/api/notifications";

describe("notifications API", () => {
  it("staff sees unread client mail for their own invoices only", async () => {
    const staff = await seedStaff({ role: "staff" });
    const other = await seedStaff({ role: "staff" });
    const client = await seedClient();
    const mine = await seedInvoice(client.id, { status: "verified", assignedTo: staff.id });
    const theirs = await seedInvoice(client.id, { status: "verified", assignedTo: other.id });
    await seedMessage(mine.id, "hello mine");
    await seedMessage(theirs.id, "hello theirs");

    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const res = await getNotifications();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.unread).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].body).toContain("hello mine");
    expect(data.items[0].id.startsWith("msg-")).toBe(true);
  });

  it("dismissing one notification hides it and drops the counter by one", async () => {
    const staff = await seedStaff({ role: "staff" });
    const client = await seedClient();
    const invoice = await seedInvoice(client.id, { status: "verified", assignedTo: staff.id });
    await seedMessage(invoice.id, "first");
    await seedMessage(invoice.id, "second");

    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const before = await (await getNotifications()).json();
    expect(before.unread).toBe(2);

    const target = before.items.find((item: { body: string }) => item.body.includes("first"));
    const dismissRes = await postNotifications(
      req(url, { method: "POST", body: { action: "dismiss", key: target.id } })
    );
    expect(dismissRes.status).toBe(200);

    const after = await (await getNotifications()).json();
    expect(after.unread).toBe(1);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].body).toContain("second");

    const db = tdb();
    const { invoiceMessages } = await import("@/db/schema");
    const rows = await db.select().from(invoiceMessages);
    expect(rows.filter((row) => row.body === "first")[0].isReadByStaff).toBe(true);
  });

  it("rejects dismissing another staff member's notification", async () => {
    const staff = await seedStaff({ role: "staff" });
    const other = await seedStaff({ role: "staff" });
    const client = await seedClient();
    const theirs = await seedInvoice(client.id, { status: "verified", assignedTo: other.id });
    const msg = await seedMessage(theirs.id, "not yours");

    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const res = await postNotifications(
      req(url, { method: "POST", body: { action: "dismiss", key: `msg-${msg.id}` } })
    );
    expect(res.status).toBe(404);

    const feed = await (await getNotifications()).json();
    expect(feed.items).toHaveLength(0);
  });

  it("rejects malformed notification keys", async () => {
    const staff = await seedStaff({ role: "staff" });
    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const res = await postNotifications(
      req(url, { method: "POST", body: { action: "dismiss", key: "msg-nope" } })
    );
    expect(res.status).toBe(400);
  });

  it("dismissing an invoice notification hides it from the queue feed", async () => {
    const staff = await seedStaff({ role: "staff" });
    const client = await seedClient();
    const invoice = await seedInvoice(client.id, { status: "assigned", assignedTo: staff.id });

    mockAuth.mockResolvedValue(officeSession({ id: staff.id, role: "staff" }));

    const before = await (await getNotifications()).json();
    expect(before.unread).toBe(1);

    const res = await postNotifications(
      req(url, { method: "POST", body: { action: "dismiss", key: `inv-${invoice.id}` } })
    );
    expect(res.status).toBe(200);

    const after = await (await getNotifications()).json();
    expect(after.unread).toBe(0);
    expect(after.items).toHaveLength(0);
  });
});
