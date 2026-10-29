"use client";
import { shortInvoiceId } from "@/lib/utils";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";

const CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "sales_invoice", label: "Sales Invoice" },
  { value: "expense_bill", label: "Expenses Bill" },
  { value: "purchase_bill", label: "Purchase Bill" },
  { value: "asset_bill", label: "Assets" },
  { value: "other", label: "Others" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "need_start", label: "Need to start" },
  { value: "in_progress", label: "In progress" },
  { value: "verified", label: "Verified" },
  { value: "collected", label: "Finished" },
  { value: "disputed", label: "Returned" },
];

const CATEGORY_LABELS: Record<string, string> = {
  sales_invoice: "Sales Invoice",
  purchase_bill: "Purchase Bill",
  expense_bill: "Expenses Bill",
  asset_bill: "Assets",
  other: "Others",
};

/** Same wording as the staff outlet Sections filters. */
const STATUS_META: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Need to start", className: "bg-orange-100 text-orange-700" },
  ocr_pending: { label: "Need to start", className: "bg-orange-100 text-orange-700" },
  ocr_done: { label: "Need to start", className: "bg-orange-100 text-orange-700" },
  ocr_failed: { label: "Need to start", className: "bg-orange-100 text-orange-700" },
  assigned: { label: "Need to start", className: "bg-orange-100 text-orange-700" },
  in_review: { label: "In progress", className: "bg-amber-100 text-amber-800" },
  needs_info: { label: "In progress", className: "bg-amber-100 text-amber-800" },
  verified: { label: "Verified", className: "bg-blue-100 text-blue-800" },
  collected: { label: "Finished", className: "bg-emerald-100 text-emerald-800" },
  disputed: { label: "Returned", className: "bg-red-100 text-red-700" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
}

export default function AdminClientReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [clientName, setClientName] = useState("Client");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function query(cursor?: string | null): string {
    const p = new URLSearchParams();
    p.set("client", id);
    if (categoryFilter !== "all") p.set("category", categoryFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (fromDate) p.set("from", `${fromDate}T00:00:00`);
    if (toDate) p.set("to", `${toDate}T23:59:59.999`);
    if (search.trim()) p.set("q", search.trim());
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, invRes, statsRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/invoices?${query()}`),
        fetch(`/api/invoices/stats?${query()}`),
      ]);
      const clientData = await clientRes.json();
      const invData = await invRes.json();
      const statsData = await statsRes.json();
      if (clientData.success) {
        const found = (clientData.clients as any[]).find((c) => c.id === id);
        if (found) setClientName(found.name);
      }
      if (!invData.success) throw new Error(invData.error || "Failed to load invoices");
      setInvoices(invData.invoices);
      setNextCursor(invData.nextCursor ?? null);
      if (statsData.success) setStats(statsData.stats);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client reports.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/invoices?${query(nextCursor)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load more");
      setInvoices((prev) => [...prev, ...data.invoices]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load more invoices.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter, fromDate, toDate]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) load();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const byStatus = stats?.byStatus ?? {};
  const inProgress = (byStatus.assigned ?? 0) + (byStatus.in_review ?? 0) + (byStatus.needs_info ?? 0);
  const finished = (byStatus.collected ?? 0) + (byStatus.disputed ?? 0);
  const sales = invoices.filter((i) => i.category === "sales_invoice");
  const bills = invoices.filter((i) => i.category !== "sales_invoice");
  const showSplit = categoryFilter === "all";

  function card(inv: any) {
    const meta = statusMeta(inv.status);
    return (
      <Link
        key={inv.id}
        href={`/admin/invoices/${inv.id}`}
        className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-xs text-slate-600">
            <span className="dc-mono">{shortInvoiceId(inv)}</span>
            {inv.createdAt
              ? <span> · {`${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>
              : null}
            <span> · {CATEGORY_LABELS[inv.category] || inv.category || "—"}</span>
          </div>
          <span className={`dc-chip flex-shrink-0 ${meta.className}`}>{meta.label}</span>
        </div>
        <div className="text-sm font-bold text-slate-900">
          J${inv.ocrData?.amount || "0.00"}
        </div>
        {inv.outlet?.name && (
          <div className="text-[11px] text-slate-500 mt-1">{inv.outlet.name}</div>
        )}
      </Link>
    );
  }

  return (
    <AppShell
      role="admin"
      title="Reports Uploaded"
      subtitle={`Client: ${clientName}`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/admin/clients" className="dc-btn">
            Back to Clients
          </Link>
          <Link href={`/admin/dashboard?client=${encodeURIComponent(id)}`} className="dc-btn">
            Open in Queue
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="dc-kpi"><span>Total uploaded</span><b>{stats ? stats.total : "…"}</b></div>
        <div className="dc-kpi"><span>In progress</span><b>{stats ? inProgress : "…"}</b></div>
        <div className="dc-kpi"><span>Verified</span><b>{stats ? byStatus.verified ?? 0 : "…"}</b></div>
        <div className="dc-kpi"><span>Finished</span><b>{stats ? finished : "…"}</b></div>
      </div>

      <div className="dc-card p-4">
        <div className="text-xs font-bold text-slate-800 mb-2">Sections</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none max-w-[180px]"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none max-w-[180px]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700">From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none"
            />
            <span className="text-xs font-medium text-slate-700">To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none"
            />
          </div>
          {(categoryFilter !== "all" || statusFilter !== "all" || fromDate || toDate) && (
            <button
              onClick={() => {
                setCategoryFilter("all");
                setStatusFilter("all");
                setFromDate("");
                setToDate("");
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline"
            >
              Clear
            </button>
          )}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice ID or document type…"
          className="mt-3 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
        />
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      {showSplit ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Invoices · {sales.length}</h2>
            <div className="space-y-3">{sales.map(card)}</div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Bills · {bills.length}</h2>
            <div className="space-y-3">{bills.map(card)}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">{invoices.map(card)}</div>
      )}

      {invoices.length === 0 && !loading && (
        <p className="text-sm text-slate-400 text-center py-8">No invoices match these filters.</p>
      )}
      {loading && invoices.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">Loading invoices…</p>
      )}
      {nextCursor && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="dc-btn">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
