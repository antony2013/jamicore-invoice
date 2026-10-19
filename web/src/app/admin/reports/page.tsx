"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

type ReportEntry = {
  id: string;
  fileName: string;
  notes: string | null;
  source: string;
  createdAt: string;
  uploadedBy: string | null;
  invoice: {
    id: string;
    status: string;
    category: string;
    createdAt: string;
    invoiceNo: string | null;
    amount: string | null;
  } | null;
  client: { id: string; name: string } | null;
};

export default function AdminReportsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState<string | null>(null);

  function query(cursor?: string | null): string {
    const p = new URLSearchParams();
    if (clientFilter !== "all") p.set("client", clientFilter);
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, repRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/reports?${query()}`),
      ]);
      const clientData = await clientRes.json();
      const repData = await repRes.json();
      if (clientData.success) setClients(clientData.clients);
      if (!repData.success) throw new Error(repData.error || "Failed to load reports");
      setReports(repData.reports);
      setNextCursor(repData.nextCursor ?? null);
      setConfirmId(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load report library.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/reports?${query(nextCursor)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load more");
      setReports((prev) => [...prev, ...data.reports]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load more reports.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openReport(rep: ReportEntry, download: boolean) {
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

  async function handleDelete(rep: ReportEntry) {    if (confirmId !== rep.id) {
      setConfirmId(rep.id);
      return;
    }
    setDeletingId(rep.id);
    try {
      const res = await fetch(`/api/reports/${rep.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete report");
      setReports((prev) => prev.filter((r) => r.id !== rep.id));
      setConfirmId(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to delete report.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  return (
    <AppShell
      role="admin"
      title="Reports & Documents"
      subtitle="Upload, organize and view client reports."
    >
      <Link
        href="/admin/dashboard"
        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition"
      >
        ⬆ Upload Report
      </Link>

      <h2 className="text-sm font-bold text-slate-900">Client report library</h2>
      <select
        value={clientFilter}
        onChange={(e) => setClientFilter(e.target.value)}
        className="dc-ctl w-full max-w-md"
      >
        <option value="all">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      <div className="space-y-2">
        {reports.length === 0 && !loading && (
          <p className="text-sm text-slate-400 text-center py-8">No reports shared yet.</p>
        )}
        {loading && reports.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Loading library…</p>
        )}
        {reports.map((rep) => (
          <Card key={rep.id} className="p-4">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-lg flex-shrink-0">
                🗎
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{rep.fileName}</div>
                <div className="text-[11px] text-slate-500">
                  {rep.client?.name || "Unknown"} ·{" "}
                  {rep.createdAt
                    ? new Date(rep.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : ""}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    onClick={() => openReport(rep, false)}
                    disabled={fetchingUrl === rep.id}
                    className="dc-btn disabled:opacity-50"
                  >
                    {fetchingUrl === rep.id ? "Opening…" : "👁 View"}
                  </button>
                  <button
                    onClick={() => openReport(rep, true)}
                    disabled={fetchingUrl === rep.id}
                    className="dc-btn disabled:opacity-50"
                  >
                    ⬇ Download
                  </button>
                  <button
                    onClick={() => handleDelete(rep)}
                    disabled={deletingId === rep.id}
                    className={`px-4 py-0 h-11 rounded-lg border text-sm font-medium transition disabled:opacity-50 ${
                      confirmId === rep.id
                        ? "bg-red-600 border-red-600 text-white hover:bg-red-700"
                        : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    {deletingId === rep.id ? "Deleting…" : confirmId === rep.id ? "Confirm delete" : "🗑 Delete"}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

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
