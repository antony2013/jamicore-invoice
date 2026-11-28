"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, RotateCcw, Trash2, Upload } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

type ReportEntry = {
  id: string;
  fileName: string;
  notes: string | null;
  source: string;
  createdAt: string;
  uploadedBy: string | null;
  deletedAt?: string | null;
  deleteReason?: string | null;
  deletedByName?: string | null;
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

export default function AdminReportsView({
  initialTab = "library",
}: {
  initialTab?: "library" | "trash";
}) {
  const [clients, setClients] = useState<any[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const tab = initialTab;
  const [trash, setTrash] = useState<ReportEntry[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function query(cursor?: string | null, trashView = false): string {
    const p = new URLSearchParams();
    if (clientFilter !== "all") p.set("client", clientFilter);
    if (trashView) p.set("trash", "1");
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

  async function loadTrash() {
    setTrashLoading(true);
    try {
      const res = await fetch(`/api/reports?${query(null, true)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load trash");
      setTrash(data.reports ?? []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load trash.");
    } finally {
      setTrashLoading(false);
    }
  }

  async function restoreReport(rep: ReportEntry) {
    setRestoringId(rep.id);
    setLoadError(null);
    try {
      const res = await fetch(`/api/reports/${rep.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore report");
      setTrash((prev) => prev.filter((r) => r.id !== rep.id));
      await load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to restore report.");
    } finally {
      setRestoringId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  useEffect(() => {
    if (tab === "trash") loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, clientFilter]);

  return (
    <AppShell
      role="admin"
      title="Reports & Documents"
      subtitle="Upload, organize and view client reports."
      actions={
        tab === "library" ? (
          <Link href="/admin/dashboard" className="dc-btn dc-btn-pri inline-flex items-center gap-1.5">
            <Upload className="h-4 w-4" />
            Upload Report
          </Link>
        ) : undefined
      }
    >
      <h2 className="text-sm font-bold text-slate-900">
        {tab === "trash" ? "Trash" : "Client report library"}
      </h2>
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

      {tab === "trash" ? (
        <div className="space-y-2">
          {trashLoading && trash.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-500">Loading trash…</p>
            </div>
          )}
          {!trashLoading && trash.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">Nothing in the trash.</p>
              <p className="mt-1 text-xs text-slate-400">
                A deleted report keeps its remark here until it is restored.
              </p>
            </div>
          )}
          {trash.map((rep) => (
            <Card key={rep.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Trash2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate line-through">
                    {rep.fileName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {rep.client?.name || "Unknown"} · deleted{" "}
                    {rep.deletedAt
                      ? new Date(rep.deletedAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                    {rep.deletedByName ? ` by ${rep.deletedByName}` : ""}
                  </div>
                  <div className="mt-1 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Reason: </span>
                    {rep.deleteReason || "—"}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button
                      onClick={() => restoreReport(rep)}
                      disabled={restoringId === rep.id}
                      className="dc-btn inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {restoringId === rep.id ? (
                        "Restoring…"
                      ) : (
                        <>
                          <RotateCcw className="h-4 w-4" /> Restore
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {reports.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">No reports shared yet.</p>
              <p className="mt-1 text-xs text-slate-400">
                Reports uploaded against an invoice appear here, grouped by client.
              </p>
            </div>
          )}
          {loading && reports.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-500">Loading library…</p>
            </div>
          )}
          {reports.map((rep) => {
            // One report per row: the date leads, then the invoice amount and
            // its paid state, so the library reads like a ledger.
            const dateLabel = rep.createdAt
              ? new Date(rep.createdAt).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })
              : "";
            const amountLabel = rep.invoice?.amount
              ? `${Number(rep.invoice.amount).toFixed(3)} KWD`
              : "—";
            const paid = rep.invoice?.status === "collected";
            return (
              <Card key={rep.id} className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                    <FileSpreadsheet className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-900">
                      {dateLabel || rep.fileName}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {rep.fileName} · {rep.client?.name || "Unknown"}
                    </div>
                  </div>
                  <div className="w-32 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {amountLabel}
                  </div>
                  <span
                    className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      paid
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {paid ? "Paid" : "Unpaid"}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "library" && nextCursor && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="dc-btn">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
