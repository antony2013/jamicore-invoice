"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Bell,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function StaffDashboard() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; unassigned: number; byPriority: Record<string, number>; total: number } | null>(null);

  function listParams() {
    const params = new URLSearchParams();
    params.set("assigned_to", "me");
    params.set("limit", "50");
    return params.toString();
  }

  async function loadAssignedInvoices() {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/invoices?${listParams()}`),
        fetch(`/api/invoices/stats?assigned_to=me`),
      ]);
      const data = await listRes.json();
      const statsData = await statsRes.json();
      if (data.success) {
        setInvoices(data.invoices);
        setDismissedIds([]);
      }
      if (statsData.success) setStats(statsData.stats);
    } catch (err) {
      console.error("Failed to load assigned invoices:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignedInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtering happens server-side; the grid renders the loaded page(s).
  const visibleInvoices = invoices;

  // Client-wise cards are derived only from loaded assigned invoices.
  const clientSummaries = (() => {
    const byId = new Map<string, { id: string; name: string; pending: number; toStart: number; inProgress: number; verified: number }>();
    for (const inv of visibleInvoices) {
      const id = inv.clientId || inv.client?.id || "unknown";
      const name = inv.client?.name || (id === "unknown" ? "Unknown client" : id.substring(0, 8));
      const summary = byId.get(id) ?? { id, name, pending: 0, toStart: 0, inProgress: 0, verified: 0 };
      if (inv.status === "assigned") summary.toStart += 1;
      if (inv.status === "in_review" || inv.status === "needs_info") summary.inProgress += 1;
      if (inv.status === "verified") summary.verified += 1;
      if (inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info") summary.pending += 1;
      byId.set(id, summary);
    }
    return Array.from(byId.values()).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  })();

  function timeAgo(value: unknown): string {
    const t = value ? new Date(value as string).getTime() : 0;
    if (!t) return "";
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return `${Math.floor(h / 24)} d ago`;
  }

  // Action-needed items derived from loaded assigned invoices (no new backend).
  const actionItems = visibleInvoices
    .filter((inv) => inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info")
    .filter((inv) => !dismissedIds.includes(inv.id))
    .map((inv) => ({
      id: inv.id,
      title:
        inv.status === "assigned"
          ? "New invoice uploaded"
          : inv.status === "in_review"
            ? "Invoice requires review"
            : "Client reply needs review",
      subtitle: `${inv.client?.name || "Unknown client"} Ã‚Â· ${shortInvoiceId(inv)}`,
      when: timeAgo(inv.updatedAt || inv.createdAt),
    }))
    .sort((a, b) => {
      const ta = visibleInvoices.find((v) => v.id === a.id);
      const tb = visibleInvoices.find((v) => v.id === b.id);
      return new Date(tb?.updatedAt || tb?.createdAt || 0).getTime() - new Date(ta?.updatedAt || ta?.createdAt || 0).getTime();
    })
    .slice(0, 3);

  return (
    <AppShell
      role="staff"
      title="My Assigned Invoices"
      subtitle="Review document scans, verify and enter invoice data, and manage collection lifecycle"
      actions={
        <div className="flex items-center gap-2">
          <a href="#notifications" className="dc-btn" title="Action-needed items">
            Ã°Å¸â€â€{actionItems.length > 0 ? ` ${actionItems.length}` : ""}
          </a>
          <button onClick={loadAssignedInvoices} className="dc-btn" type="button">
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      }
    >
        {/* Notifications: action-needed items from the loaded assigned queue */}
        <section id="notifications" className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">Notifications</h2>
            {actionItems.length > 0 && (
              <button
                onClick={() => setDismissedIds(actionItems.map((a) => a.id))}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {actionItems.length === 0 ? (
            <p className="text-xs text-slate-400">
              {loading ? "Checking the assigned queueÃ¢â‚¬Â¦" : "Nothing needs action right now."}
            </p>
          ) : (
            <div className="space-y-2">
              {actionItems.map((a) => (
                <Link
                  key={a.id}
                  href={`/staff/invoices/${a.id}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100"
                >
                  <div className="text-xs">
                    <div className="font-bold text-slate-900">{a.title}</div>
                    <div className="text-slate-500">{a.subtitle}{a.when ? ` Ã‚Â· ${a.when}` : ""}</div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>
        {/* My Counts (server-computed over ALL my rows, not just the loaded page) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To Start</div>
            <div className="text-2xl font-bold text-purple-700 mt-1">
              {stats ? stats.byStatus.assigned ?? 0 : "Ã¢â‚¬Â¦"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">In Progress</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {stats ? (stats.byStatus.in_review ?? 0) + (stats.byStatus.needs_info ?? 0) : "Ã¢â‚¬Â¦"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Verified</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">
              {stats ? stats.byStatus.verified ?? 0 : "Ã¢â‚¬Â¦"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Finished Ã¢Å“â€¦</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {stats ? (stats.byStatus.collected ?? 0) + (stats.byStatus.disputed ?? 0) : "Ã¢â‚¬Â¦"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Assigned Verification Queue</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pick a client to open its invoices, messages and reports
            </p>
          </div>
          <button
            onClick={loadAssignedInvoices}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div id="client-cards">
          <div className="text-xs font-bold text-slate-800 mb-2">Client-Wise Filter</div>
          {clientSummaries.length === 0 ? (
            <div className="py-12 bg-white rounded-2xl border border-slate-200 text-center text-slate-400">
              <p className="text-sm font-medium text-slate-600">
                {loading ? "Loading queue..." : "No invoices assigned to you yet."}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                New invoices assigned by admin will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {clientSummaries.map((c) => (
                <Card
                  key={c.id}
                  onClick={() => router.push(`/staff/clients/${encodeURIComponent(c.id)}`)}
                  className="p-4 cursor-pointer transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">{c.name}</div>
                    <span className="relative p-1 rounded-md text-slate-500">
                      <Bell className="w-4 h-4" />
                      {c.pending > 0 && (
                        <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[10px] text-white flex items-center justify-center">
                          {c.pending}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">Total Pending Actions: {c.pending}</div>
                  <div className="grid grid-cols-2 gap-1 mt-1 text-[11px] text-slate-500">
                    <span>To Start: {c.toStart}</span>
                    <span>In Progress: {c.inProgress}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Verified: {c.verified}</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </AppShell>
  );
}
