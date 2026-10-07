"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  User,
} from "lucide-react";
import AppShell from "@/components/AppShell";

export default function StaffDashboard() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; unassigned: number; byPriority: Record<string, number>; total: number } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function listParams(cursor?: string | null) {
    const params = new URLSearchParams();
    params.set("assigned_to", "me");
    if (statusFilter !== "all") params.set("status", statusFilter);
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
        fetch(`/api/invoices/stats?assigned_to=me${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`),
      ]);
      const data = await listRes.json();
      const statsData = await statsRes.json();
      if (data.success) {
        setInvoices(data.invoices);
        setNextCursor(data.nextCursor ?? null);
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
  }, [statusFilter]);

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
        <button onClick={loadAssignedInvoices} className="dc-btn" type="button">
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      }
    >
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
                  <div className="mb-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-700 text-[10px] font-bold uppercase">
                      {inv.category === "other" && inv.categoryDetail
                        ? inv.categoryDetail
                        : { sales_invoice: "Sales Invoice", purchase_bill: "Purchase Bill", expense_bill: "Expense Bill", asset_bill: "Asset Bill", other: "Other" }[inv.category as string] || inv.category || "Sales Invoice"}
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
