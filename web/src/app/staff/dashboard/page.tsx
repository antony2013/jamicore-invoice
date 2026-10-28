"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Clock, MessageSquare, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";

type SessionUser = { name?: string | null; role?: string | null };

const timeAgo = (value: unknown): string => {
  const t = value ? new Date(value as string).getTime() : 0;
  if (!t) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
};

export default function StaffDashboard() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<{
    byStatus: Record<string, number>;
    unassigned: number;
    byPriority: Record<string, number>;
    total: number;
  } | null>(null);
  const [unreadByClient, setUnreadByClient] = useState<Record<string, number>>({});
  const [user, setUser] = useState<SessionUser | null>(null);
  const [clientFilter, setClientFilter] = useState("all");

  function listParams() {
    const params = new URLSearchParams();
    params.set("assigned_to", "me");
    params.set("limit", "50");
    return params.toString();
  }

  async function loadAssignedInvoices() {
    setLoading(true);
    try {
      const [listRes, statsRes, threadsRes] = await Promise.all([
        fetch(`/api/invoices?${listParams()}`),
        fetch(`/api/invoices/stats?assigned_to=me`),
        fetch(`/api/threads?folder=all&limit=100`),
      ]);
      const data = await listRes.json();
      const statsData = await statsRes.json();
      if (data.success) {
        setInvoices(data.invoices);
        setDismissedIds([]);
      }
      if (statsData.success) setStats(statsData.stats);

      const threadsData = await threadsRes.json();
      if (threadsData.success) {
        const counts: Record<string, number> = {};
        for (const thread of threadsData.threads as Array<{
          client?: { id?: string };
          unread?: number;
        }>) {
          const clientId = thread.client?.id;
          if (!clientId) continue;
          counts[clientId] = (counts[clientId] ?? 0) + Number(thread.unread ?? 0);
        }
        setUnreadByClient(counts);
      }
    } catch (err) {
      console.error("Failed to load assigned invoices:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignedInvoices();
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {
        // Avatar falls back to a generic initial.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtering happens server-side; the grid renders the loaded page(s).
  const visibleInvoices = invoices;

  // Client-wise cards are derived only from loaded assigned invoices.
  const clientSummaries = (() => {
    const byId = new Map<
      string,
      {
        id: string;
        name: string;
        pending: number;
        toStart: number;
        inProgress: number;
        verified: number;
        latest: any;
      }
    >();
    for (const inv of visibleInvoices) {
      const id = inv.clientId || inv.client?.id || "unknown";
      const name = inv.client?.name || (id === "unknown" ? "Unknown client" : id.substring(0, 8));
      const summary =
        byId.get(id) ?? { id, name, pending: 0, toStart: 0, inProgress: 0, verified: 0, latest: null };
      if (inv.status === "assigned") summary.toStart += 1;
      if (inv.status === "in_review" || inv.status === "needs_info") summary.inProgress += 1;
      if (inv.status === "verified") summary.verified += 1;
      if (inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info") {
        summary.pending += 1;
      }
      const latestAt = new Date(summary.latest?.updatedAt || summary.latest?.createdAt || 0).getTime();
      const invAt = new Date(inv.updatedAt || inv.createdAt || 0).getTime();
      if (!summary.latest || invAt > latestAt) summary.latest = inv;
      byId.set(id, summary);
    }
    return Array.from(byId.values()).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  })();

  const cardClients =
    clientFilter === "all" ? clientSummaries : clientSummaries.filter((c) => c.id === clientFilter);

  // Action-needed items derived from the loaded assigned queue.
  const actionItems = visibleInvoices
    .filter((inv) => inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info")
    .filter((inv) => !dismissedIds.includes(inv.id))
    .map((inv) => ({
      id: inv.id,
      status: inv.status as string,
      title:
        inv.status === "assigned"
          ? "New invoice uploaded"
          : inv.status === "in_review"
            ? "Invoice requires review"
            : "Client reply needs review",
      subtitle: `${inv.client?.name || "Unknown client"} · ${shortInvoiceId(inv)}`,
      when: timeAgo(inv.updatedAt || inv.createdAt),
    }))
    .sort((a, b) => {
      const ta = visibleInvoices.find((v) => v.id === a.id);
      const tb = visibleInvoices.find((v) => v.id === b.id);
      return (
        new Date(tb?.updatedAt || tb?.createdAt || 0).getTime() -
        new Date(ta?.updatedAt || ta?.createdAt || 0).getTime()
      );
    })
    .slice(0, 3);

  async function dismissAll() {
    const keys = actionItems.map((item) => `inv-${item.id}`);
    setDismissedIds(actionItems.map((a) => a.id));
    try {
      await Promise.all(
        keys.map((key) =>
          fetch("/api/notifications", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "dismiss", key }),
          })
        )
      );
    } catch {
      // The next load restores the real state.
    }
  }

  const total = stats?.total ?? 0;
  const inProgress = (stats?.byStatus.in_review ?? 0) + (stats?.byStatus.needs_info ?? 0);
  const uploaded = stats ? (stats.byStatus.assigned ?? 0) : "…";
  const finished = (stats?.byStatus.collected ?? 0) + (stats?.byStatus.disputed ?? 0);
  const initial = (user?.name || "Staff").trim().charAt(0).toUpperCase();

  return (
    <AppShell
      role="staff"
      title="InvoiceDesk"
      headerBrand={{ name: "InvoiceDesk", subtitle: "Staff Invoice Processing Portal" }}
      actions={
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
              {initial}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[12px] font-semibold text-slate-900">
                {user?.name || "Staff"}
              </span>
              <span className="block text-[10px] text-slate-500">Invoice Staff</span>
            </span>
          </span>
        </div>
      }
    >
      {/* Notifications */}
      <section id="notifications">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-slate-900">Notifications</h2>
          {actionItems.length > 0 && (
            <button onClick={dismissAll} className="text-[12px] font-medium text-blue-600 hover:underline">
              Mark all read
            </button>
          )}
        </div>
        {actionItems.length === 0 ? (
          <p className="text-xs text-slate-400">
            {loading ? "Checking the assigned queue…" : "Nothing needs action right now."}
          </p>
        ) : (
          <div className="space-y-2">
            {actionItems.map((item) => {
              const Icon =
                item.status === "needs_info" ? MessageSquare : item.status === "in_review" ? Sparkles : Clock;
              return (
                <Link
                  key={item.id}
                  href={`/staff/invoices/${item.id}`}
                  className="flex items-center gap-3 rounded-xl bg-[#EFF6FF] px-4 py-3 transition hover:bg-[#E4EFFF]"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-blue-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-slate-900">{item.title}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {item.subtitle}
                      {item.when ? ` · ${item.when}` : ""}
                    </span>
                  </span>
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* My Assigned Invoices */}
      <section className="rounded-xl border border-slate-200 bg-[#F9FAFB] p-4">
        <h2 className="text-[16px] font-bold text-slate-900">My Assigned Invoices</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Review the assigned work, verify each invoice, and manage workflow status
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total</div>
            <div className="mt-0.5 text-[22px] font-bold leading-tight text-slate-900">
              {stats ? total : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
              In Progress
            </div>
            <div className="mt-0.5 text-[22px] font-bold leading-tight text-amber-600">
              {stats ? inProgress : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Uploaded</div>
            <div className="mt-0.5 text-[22px] font-bold leading-tight text-blue-600">{uploaded}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Finished</div>
            <div className="mt-0.5 text-[22px] font-bold leading-tight text-emerald-600">
              {stats ? finished : "…"}
            </div>
          </div>
        </div>
      </section>

      {/* Assigned Verification Queue */}
      <section id="client-cards">
        <h2 className="text-[18px] font-bold text-slate-900">Assigned Verification Queue</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Review client invoices, verify details and update the processing status
        </p>

        <div className="mt-3">
          <label
            htmlFor="client-filter"
            className="mb-1 block text-[11px] font-semibold text-slate-700"
          >
            Client View Filter
          </label>
          <select
            id="client-filter"
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            className="h-9 w-48 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500"
          >
            <option value="all">All Clients</option>
            {clientSummaries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {cardClients.length === 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white py-12 text-center">
            <p className="text-sm font-medium text-slate-600">
              {loading ? "Loading queue..." : "No invoices assigned to you yet."}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              New invoices assigned by admin will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cardClients.map((c) => {
              const unread = unreadByClient[c.id] ?? 0;
              const busy = c.pending > 0;
              const latest = c.latest;
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/staff/clients/${encodeURIComponent(c.id)}`)}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-[13px] font-bold text-slate-900">{c.name}</div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        title={unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : "No unread messages"}
                        aria-label={`${c.name} messages (${unread} unread)`}
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/staff/messages?client=${encodeURIComponent(c.id)}`);
                        }}
                        className="relative rounded-md p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Bell className="h-3.5 w-3.5" />
                        {unread > 0 && (
                          <Badge className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-0.5 text-[9px] text-white">
                            {unread}
                          </Badge>
                        )}
                      </button>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          busy
                            ? "border-amber-200 bg-amber-50 text-amber-600"
                            : "border-emerald-200 bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {busy ? "In Progress" : "Uploaded"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-500">
                    {c.pending} pending invoice{c.pending === 1 ? "" : "s"}
                  </div>
                  {latest && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">{shortInvoiceId(latest)}</span>
                      {" · "}
                      {latest.status
                        ? latest.status.charAt(0).toUpperCase() + latest.status.slice(1)
                        : "Uploaded"}
                      {` ${timeAgo(latest.updatedAt || latest.createdAt)}`}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
                    <span>
                      In Progress: <span className="font-semibold text-slate-700">{c.inProgress}</span>
                    </span>
                    <span>
                      Verified: <span className="font-semibold text-slate-700">{c.verified}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
