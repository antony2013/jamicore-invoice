"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Building2, FileText, Store, User } from "lucide-react";

import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function StaffClientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reportCache, setReportCache] = useState<Record<string, any>>({});
  const [checkingReports, setCheckingReports] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ assigned_to: "me", client: id, limit: "200" });
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load client");
      const list = (data.invoices ?? []) as any[];
      setInvoices(list);
      const name = list.find((inv) => inv.client?.name)?.client?.name;
      if (name) setClientName(name);
      void checkReports(list);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client overview.");
    } finally {
      setLoading(false);
    }
  }

  async function checkReports(list: any[]) {
    if (list.length === 0) {
      setReportCache({});
      return;
    }
    setCheckingReports(true);
    try {
      const settled = await Promise.allSettled(
        list.map(async (inv) => {
          const res = await fetch(`/api/invoices/${inv.id}/report`);
          const data = await res.json();
          return { invId: inv.id, report: data.success && data.report ? data.report : null };
        })
      );
      setReportCache((prev) => {
        const next = { ...prev };
        for (const result of settled) {
          if (result.status !== "fulfilled") continue;
          next[result.value.invId] = result.value.report;
        }
        return next;
      });
    } finally {
      setCheckingReports(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const outletGroups = (() => {
    const byId = new Map<string, { id: string; name: string; pending: number; total: number }>();
    for (const inv of invoices) {
      const outletId = inv.outletId || inv.outlet?.id || "none";
      const outletName = inv.outlet?.name || (outletId === "none" ? "No outlet" : "Outlet");
      const group = byId.get(outletId) ?? { id: outletId, name: outletName, pending: 0, total: 0 };
      group.total += 1;
      if (inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info") {
        group.pending += 1;
      }
      byId.set(outletId, group);
    }
    return Array.from(byId.values()).sort((a, b) => b.total - a.total);
  })();

  const reports = Object.entries(reportCache)
    .filter(([, report]) => report)
    .map(([invoiceId, report]) => ({ invoiceId, ...report }))
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );

  const displayName = clientName ?? "Client";

  return (
    <AppShell role="staff" title={displayName} subtitle="Client account overview">
      <Link
        href="/staff/clients"
        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to clients
      </Link>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError}{" "}
          <button onClick={load} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      <div className="dc-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-base font-bold text-slate-900 truncate">{displayName}</div>
              <div className="text-[11px] text-slate-500">Client account overview</div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
            Active
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="dc-kpi">
          <span>Outlets</span>
          <b>{loading && invoices.length === 0 ? "…" : outletGroups.length}</b>
        </div>
        <div className="dc-kpi">
          <span>Reports</span>
          <b>{checkingReports && reports.length === 0 ? "…" : reports.length}</b>
        </div>
      </div>

      <h2 className="text-sm font-bold text-slate-900">Client workspace</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {outletGroups.map((outlet) => (
          <div key={outlet.id} className="dc-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <Store className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{outlet.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{displayName}</div>
                </div>
              </div>
              <span className="relative p-1 text-slate-500 flex-shrink-0">
                <Bell className="w-4 h-4" />
                {outlet.pending > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center">
                    {outlet.pending}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0">
                <User className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Assigned staff</div>
                <div className="text-[11px] font-semibold text-slate-700">You</div>
              </div>
            </div>
          </div>
        ))}
        {!loading && outletGroups.length === 0 && (
          <p className="text-xs text-slate-400">No outlets in your queue.</p>
        )}
        {loading && outletGroups.length === 0 && (
          <p className="text-xs text-slate-400">Loading outlets…</p>
        )}
      </div>

      <h2 className="text-sm font-bold text-slate-900">Client reports</h2>
      <div className="space-y-2">
        {checkingReports && reports.length === 0 ? (
          <p className="text-xs text-slate-400">Checking reports…</p>
        ) : reports.length === 0 ? (
          <p className="text-xs text-slate-400">No reports shared yet.</p>
        ) : (
          reports.map((report) => (
            <Card key={report.invoiceId} className="p-3 flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 truncate">{report.fileName}</div>
                <div className="text-[10px] text-slate-400">{formatDate(report.createdAt)}</div>
              </div>
              {report.downloadUrl ? (
                <a
                  href={report.downloadUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-[11px] font-semibold text-blue-600 hover:underline whitespace-nowrap"
                >
                  View
                </a>
              ) : null}
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
