"use client";
import { shortInvoiceId } from "@/lib/utils";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";

export default function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<any | null>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [reportsCapped, setReportsCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, outletRes, repRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/outlets?clientId=${encodeURIComponent(id)}`),
        fetch(`/api/reports?client=${encodeURIComponent(id)}&limit=50`),
      ]);
      const clientData = await clientRes.json();
      const outletData = await outletRes.json();
      const repData = await repRes.json();
      if (clientData.success) {
        const found = (clientData.clients as any[]).find((c) => c.id === id);
        if (!found) throw new Error("Client not found.");
        setClient(found);
      }
      if (!outletData.success) throw new Error(outletData.error || "Failed to load outlets");
      setOutlets(outletData.outlets);
      if (!repData.success) throw new Error(repData.error || "Failed to load reports");
      setReports(repData.reports);
      setReportsCapped(Boolean(repData.nextCursor));
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function openReport(rep: any, download: boolean) {
    if (!rep.invoice) return;
    setFetchingUrl(rep.id);
    try {
      const res = await fetch(`/api/invoices/${rep.invoice.id}/report`);
      const data = await res.json();
      if (!res.ok || !data.report?.downloadUrl) throw new Error(data.error || "No file available");
      if (download) {
        const a = document.createElement("a");
        a.href = data.report.downloadUrl;
        a.download = rep.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(data.report.downloadUrl, "_blank", "noopener");
      }
    } catch (err: any) {
      setLoadError(err.message || "Failed to open report.");
    } finally {
      setFetchingUrl(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <AppShell
      role="admin"
      title={client ? client.name : "Client"}
      subtitle="Client account overview"
      actions={
        <div className="flex items-center gap-2">
          {client && !client.archivedAt && (
            <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700">
              Active
            </span>
          )}
          {client?.archivedAt && (
            <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-slate-200 text-slate-600">
              Archived
            </span>
          )}
          <Link href="/admin/clients" className="dc-btn">
            Back to Clients
          </Link>
        </div>
      }
    >
      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}
      {loading && !client ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading clientÃ¢â‚¬Â¦</p>
      ) : null}
      {client ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="dc-kpi"><span>Outlets</span><b>{outlets.length}</b></div>
          <div className="dc-kpi"><span>Reports</span><b>{reports.length}{reportsCapped ? "+" : ""}</b></div>
        </div>
      ) : null}

      <h2 className="text-sm font-bold text-slate-900">Client workspace</h2>

      <div id="outlets" className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">Outlets</h2>
        <Link href="/admin/clients" className="dc-btn">Manage outlets</Link>
      </div>
      <div className="space-y-2">
        {outlets.length === 0 && (
          <p className="text-xs text-slate-400">{loading ? "Loading outletsÃ¢â‚¬Â¦" : "No outlets yet."}</p>
        )}
        {outlets.map((o) => (
          <div key={o.id} className="dc-card p-4">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center text-sm flex-shrink-0">
                Ã°Å¸ÂÂª
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">{o.name}</div>
                <div className="text-[11px] text-slate-500">{client?.name || ""}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-slate-500">
              <span>Ã°Å¸â€˜Â¤</span>
              <span>Assigned staff</span>
            </div>
            <div className="text-xs font-semibold text-slate-800">
              {o.assignedStaffName || "Manual routing"}
            </div>
            {([o.address, o.phone].filter(Boolean).length > 0) && (
              <div className="text-[11px] text-slate-500 mt-1">
                {[o.address, o.phone].filter(Boolean).join(" Ã‚Â· ")}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="text-sm font-bold text-slate-900">Client reports</h2>
      <div className="space-y-2">
        {reports.length === 0 && (
          <p className="text-xs text-slate-400">{loading ? "Loading reportsÃ¢â‚¬Â¦" : "No reports shared yet."}</p>
        )}
        {reports.map((rep: any) => (
          <div key={rep.id} className="dc-card p-4">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-lg flex-shrink-0">
                Ã°Å¸â€”Å½
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{rep.fileName}</div>
                <div className="text-[11px] text-slate-500">
                  {rep.createdAt ? new Date(rep.createdAt).toLocaleDateString() : ""}
                  {rep.invoice ? ` Ã‚Â· ${shortInvoiceId(rep.invoice)}` : ""}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    onClick={() => openReport(rep, false)}
                    disabled={fetchingUrl === rep.id}
                    className="dc-btn disabled:opacity-50"
                  >
                    {fetchingUrl === rep.id ? "OpeningÃ¢â‚¬Â¦" : "Ã°Å¸â€˜Â View"}
                  </button>
                  <button
                    onClick={() => openReport(rep, true)}
                    disabled={fetchingUrl === rep.id}
                    className="dc-btn disabled:opacity-50"
                  >
                    Ã¢Â¬â€¡ Download
                  </button>
                  {rep.invoice && (
                    <Link href={`/admin/invoices/${rep.invoice.id}`} className="text-xs text-blue-600 hover:underline">
                      Open invoice Ã¢â€ â€™
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        {reportsCapped && (
          <Link href={`/admin/clients/${id}/reports`} className="text-xs text-blue-600 hover:underline">
            View all reports Ã¢â€ â€™
          </Link>
        )}
      </div>
    </AppShell>
  );
}
