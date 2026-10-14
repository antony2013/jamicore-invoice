"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

type ReportInfo = {
  fileName: string;
  source: string;
  createdAt: string;
  downloadUrl?: string | null;
} | null;

export default function AdminReportsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, ReportInfo>>({});
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
      const [clientRes, invRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/invoices?${query()}`),
      ]);
      const clientData = await clientRes.json();
      const invData = await invRes.json();
      if (clientData.success) setClients(clientData.clients);
      if (!invData.success) throw new Error(invData.error || "Failed to load invoices");
      setInvoices(invData.invoices);
      setNextCursor(invData.nextCursor ?? null);
      setExpandedId(null);
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

  async function toggleExpand(inv: any) {
    if (expandedId === inv.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(inv.id);
    if (reports[inv.id] !== undefined) return;
    setReportBusy(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/report`);
      const data = await res.json();
      setReports((prev) => ({ ...prev, [inv.id]: data.success ? data.report : null }));
    } catch {
      setReports((prev) => ({ ...prev, [inv.id]: null }));
    } finally {
      setReportBusy(null);
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
      actions={
        <Link href="/admin/dashboard" className="dc-btn">
          Open Invoice Queue
        </Link>
      }
    >
      <Link
        href="/admin/dashboard"
        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition"
      >
        ⬆ Upload Report
      </Link>
      <p className="text-[11px] text-slate-400">
        Reports attach to invoices — pick an invoice in the queue, then generate or upload its Excel report there.
      </p>

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
        {invoices.length === 0 && !loading && (
          <p className="text-sm text-slate-400 text-center py-8">No invoices found.</p>
        )}
        {loading && invoices.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Loading library…</p>
        )}
        {invoices.map((inv) => {
          const rep = reports[inv.id];
          return (
            <Card key={inv.id} className="p-4">
              <button
                onClick={() => toggleExpand(inv)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <div className="text-xs">
                  <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
                  <span className="text-slate-500"> · {inv.client?.name || "Unknown"}</span>
                  <div className="text-[11px] text-slate-400">
                    {inv.createdAt
                      ? `${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""} · {inv.status}
                  </div>
                </div>
                <span className="text-slate-400">{expandedId === inv.id ? "▾" : "▸"}</span>
              </button>
              {expandedId === inv.id && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {reportBusy === inv.id ? (
                    <p className="text-xs text-slate-400">Loading report…</p>
                  ) : rep ? (
                    <div>
                      <div className="text-sm font-bold text-slate-900">📄 {rep.fileName}</div>
                      <div className="text-[11px] text-slate-500">
                        {rep.source === "generated" ? "Auto-generated" : "Staff upload"} ·{" "}
                        {rep.createdAt ? new Date(rep.createdAt).toLocaleString() : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {rep.downloadUrl && (
                          <>
                            <a href={rep.downloadUrl} target="_blank" rel="noopener" className="dc-btn">
                              👁 View
                            </a>
                            <a href={rep.downloadUrl} download={rep.fileName} className="dc-btn">
                              ⬇ Download
                            </a>
                          </>
                        )}
                        <Link href={`/admin/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline">
                          Open invoice →
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No report shared yet.</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
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
