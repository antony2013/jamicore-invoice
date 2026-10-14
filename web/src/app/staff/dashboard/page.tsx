"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  User,
  Bell,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function StaffDashboard() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [search, setSearch] = useState<string>("");
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; unassigned: number; byPriority: Record<string, number>; total: number } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function listParams(cursor?: string | null) {
    const params = new URLSearchParams();
    params.set("assigned_to", "me");
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (clientFilter !== "all") params.set("client", clientFilter);
    if (search.trim()) params.set("q", search.trim());
    params.set("limit", "50");
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }

  async function loadAssignedInvoices() {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/invoices?${listParams()}`),
        fetch(`/api/invoices/stats?assigned_to=me${clientFilter !== "all" ? `&client=${encodeURIComponent(clientFilter)}` : ""}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`),
      ]);
      const data = await listRes.json();
      const statsData = await statsRes.json();
      if (data.success) {
        setInvoices(data.invoices);
        setNextCursor(data.nextCursor ?? null);
        setDismissedIds([]);
      }
      if (statsData.success) setStats(statsData.stats);
    } catch (err) {
      console.error("Failed to load assigned invoices:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/invoices?${listParams(nextCursor)}`);
      const data = await res.json();
      if (data.success) {
        setInvoices((prev) => [...prev, ...data.invoices]);
        setNextCursor(data.nextCursor ?? null);
      }
    } catch (err) {
      console.error("Failed to load more invoices:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadAssignedInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, clientFilter]);

  // Debounced server search (skipped on mount)
  const searchFirst = useRef(true);
  useEffect(() => {
    if (searchFirst.current) {
      searchFirst.current = false;
      return;
    }
    const t = setTimeout(() => loadAssignedInvoices(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
      subtitle: `${inv.client?.name || "Unknown client"} · ${inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}`,
      when: timeAgo(inv.updatedAt || inv.createdAt),
    }))
    .sort((a, b) => {
      const ta = visibleInvoices.find((v) => v.id === a.id);
      const tb = visibleInvoices.find((v) => v.id === b.id);
      return new Date(tb?.updatedAt || tb?.createdAt || 0).getTime() - new Date(ta?.updatedAt || ta?.createdAt || 0).getTime();
    })
    .slice(0, 3);

  const STATUS_OPTIONS = [
    { value: "all", label: "All" },
    { value: "assigned", label: "To Start" },
    { value: "in_progress", label: "In Progress" },
    { value: "verified", label: "Verified" },
    { value: "finished", label: "Finished" },
  ];

  return (
    <AppShell
      role="staff"
      title="My Assigned Invoices"
      subtitle="Review document scans, verify and enter invoice data, and manage collection lifecycle"
      actions={
        <div className="flex items-center gap-2">
          <a href="#notifications" className="dc-btn" title="Action-needed items">
            🔔{actionItems.length > 0 ? ` ${actionItems.length}` : ""}
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
              {loading ? "Checking the assigned queue…" : "Nothing needs action right now."}
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
                    <div className="text-slate-500">{a.subtitle}{a.when ? ` · ${a.when}` : ""}</div>
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
              {stats ? stats.byStatus.assigned ?? 0 : "…"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">In Progress</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {stats ? (stats.byStatus.in_review ?? 0) + (stats.byStatus.needs_info ?? 0) : "…"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Verified</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">
              {stats ? stats.byStatus.verified ?? 0 : "…"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Finished ✅</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {stats ? (stats.byStatus.collected ?? 0) + (stats.byStatus.disputed ?? 0) : "…"}
            </div>
          </div>
        </div>

        <div id="client-cards" className="bg-white p-4 rounded-xl border border-slate-200 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-xs font-bold text-slate-800">Client-Wise Filter</div>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none max-w-[240px]"
            >
              <option value="all">All Clients</option>
              {clientSummaries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.pending} pending
                </option>
              ))}
            </select>
            {clientFilter !== "all" && (
              <button
                onClick={() => setClientFilter("all")}
                className="text-xs text-slate-500 hover:text-slate-800 underline self-start sm:self-auto"
              >
                Clear client
              </button>
            )}
            <span className="text-[11px] text-slate-400">Cards reflect the loaded assigned invoices.</span>
          </div>
          {clientSummaries.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {clientSummaries.map((c) => (
                <Card
                  key={c.id}
                  onClick={() => router.push(`/staff/clients/${encodeURIComponent(c.id)}`)}
                  className={`p-4 cursor-pointer transition hover:shadow-md ${
                    clientFilter === c.id ? "border-blue-600 ring-1 ring-blue-600" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">{c.name}</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setClientFilter(clientFilter === c.id ? "all" : c.id);
                      }}
                      title="Filter queue to this client"
                      className="relative p-1 rounded-md text-slate-500 hover:bg-slate-100"
                    >
                      <Bell className="w-4 h-4" />
                      {c.pending > 0 && (
                        <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[10px] text-white flex items-center justify-center">
                          {c.pending}
                        </Badge>
                      )}
                    </button>
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

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Assigned Verification Queue</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Review document scans, verify and enter invoice data, and manage collection lifecycle
            </p>
          </div>
          <button
            onClick={loadAssignedInvoices}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {/* Invoice Grid / List */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatusFilter(o.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  statusFilter === o.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, vendor, invoice no…"
            className="flex-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <span className="text-[11px] text-slate-400 whitespace-nowrap">
            {visibleInvoices.length} shown{stats ? ` of ${stats.total}` : ""}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleInvoices.length === 0 ? (
            <div className="col-span-full py-16 bg-white rounded-2xl border border-slate-200 text-center text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">
                {invoices.length === 0 ? "No invoices assigned to you yet." : "No invoices match the filter."}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                New invoices assigned by admin will appear here automatically.
              </p>
            </div>
          ) : (
            visibleInvoices.map((inv) => (
              <div
                key={inv.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="text-xs text-slate-600 mb-2">
                    <span className="dc-mono">{inv.id ? `${String(inv.id).substring(0, 8)}…` : "—"}</span>
                    {inv.createdAt
                      ? <span> · {`${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>
                      : null}
                    <span> · {inv.category === "other" && inv.categoryDetail
                      ? inv.categoryDetail
                      : { sales_invoice: "Sales Invoice", purchase_bill: "Purchase Bill", expense_bill: "Expense Bill", asset_bill: "Assets" }[inv.category as string] || inv.category || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        inv.status === "collected"
                          ? "bg-emerald-100 text-emerald-800"
                          : inv.status === "in_review"
                          ? "bg-blue-100 text-blue-800"
                          : inv.status === "needs_info"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-purple-100 text-purple-800"
                      }`}
                    >
                      {inv.status}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        inv.priority === "urgent"
                          ? "bg-red-50 text-red-600"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {inv.priority}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">
                    {inv.ocrData?.vendor || "Pending Vendor Confirmation"}
                  </h3>
                  <div className="text-xs text-slate-500 mb-3">
                    Client: <strong>{inv.client?.name}</strong> ({inv.client?.phone || inv.client?.email})
                    {inv.outlet && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-semibold">
                        ◍ {inv.outlet.name}
                      </span>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-1 mb-4">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Amount:</span>
                      <span className="font-bold text-slate-900">J${inv.ocrData?.amount || "0.00"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Invoice No:</span>
                      <span className="font-mono text-slate-700">{inv.ocrData?.invoiceNo || "—"}</span>
                    </div>
                    {inv.ocrData?.confidence && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">OCR Confidence:</span>
                        <span className="font-medium text-blue-600">{inv.ocrData.confidence}%</span>
                      </div>
                    )}
                  </div>
                </div>

                <Link
                  href={`/staff/invoices/${inv.id}`}
                  className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5"
                >
                  Verify & Process <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))
          )}
        </div>
        {nextCursor && (
          <div className="flex justify-center mt-6">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition shadow-sm disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </AppShell>
  );
}
