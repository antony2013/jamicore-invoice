"use client";

import { useEffect, useMemo, useState } from "react";
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
  outlet: { id: string; name: string } | null;
};

type OutletOption = { id: string; name: string };

const REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_REPORT_BYTES = 10 * 1024 * 1024;

export default function StaffReportsPage() {
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [outletFilter, setOutletFilter] = useState("all");
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadInvoices, setUploadInvoices] = useState<any[]>([]);
  const [uploadInvoiceId, setUploadInvoiceId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [scopedClient, setScopedClient] = useState<string | null>(null);

  function query(cursor?: string | null): string {
    const p = new URLSearchParams();
    if (clientFilter !== "all") p.set("client", clientFilter);
    if (outletFilter !== "all") p.set("outlet", outletFilter);
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const invParams = new URLSearchParams();
      invParams.set("limit", "100");
      if (clientFilter !== "all") invParams.set("client", clientFilter);
      const [invRes, repRes] = await Promise.all([
        fetch(`/api/invoices?${invParams.toString()}`),
        fetch(`/api/reports?${query()}`),
      ]);
      const invData = await invRes.json();
      const repData = await repRes.json();
      if (invData.success) {
        const seen = new Map<string, string>();
        for (const inv of invData.invoices ?? []) {
          const outletId = inv.outletId || inv.outlet?.id || "none";
          const outletName = inv.outlet?.name || (outletId === "none" ? "No outlet" : "Outlet");
          if (!seen.has(outletId)) seen.set(outletId, outletName);
        }
        setOutlets(Array.from(seen, ([id, name]) => ({ id, name })));
        const invs = invData.invoices ?? [];
        setUploadInvoices(invs);
        // Inside a client's report library the upload must never make you hunt
        // for the invoice: target the client's most recent one by default.
        if (scopedClient) setUploadInvoiceId((prev) => prev || invs[0]?.id || "");
      }
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

  async function uploadReport() {
    if (!uploadInvoiceId || !uploadFile) return;
    if (!uploadFile.name.toLowerCase().endsWith(".xlsx")) {
      setLoadError("Only .xlsx reports can be uploaded.");
      return;
    }
    if (uploadFile.size > MAX_REPORT_BYTES) {
      setLoadError("Report must be under 10 MB.");
      return;
    }
    setUploading(true);
    setLoadError(null);
    try {
      const startRes = await fetch(`/api/invoices/${uploadInvoiceId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upload-url", contentLength: uploadFile.size }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Could not start upload");

      const putRes = await fetch(startData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": REPORT_MIME },
        body: uploadFile,
      });
      if (!putRes.ok) throw new Error("Upload failed. Try again.");

      const confirmRes = await fetch(`/api/invoices/${uploadInvoiceId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", s3Key: startData.s3Key, fileName: uploadFile.name }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || "Could not save report");

      setUploadOpen(false);
      setUploadFile(null);
      setUploadInvoiceId("");
      await load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to upload report.");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("client");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      setScopedClient(id);
      setClientFilter(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, outletFilter]);

  const outletName = useMemo(
    () => outlets.find((o) => o.id === outletFilter)?.name,
    [outlets, outletFilter]
  );

  return (
    <AppShell
      role="staff"
      title="Reports & Documents"
      subtitle="Upload, organize and view client reports."
      nav={[
        {
          href: scopedClient ? `/staff/messages?client=${scopedClient}` : "/staff/messages",
          label: "Messages",
        },
        {
          href: scopedClient ? `/staff/reports?client=${scopedClient}` : "/staff/reports",
          label: "Reports",
        },
      ]}
      actions={
        scopedClient ? (
          <Link href={`/staff/clients/${scopedClient}`} className="dc-btn">
            ← Back to client
          </Link>
        ) : undefined
      }
    >
      <button
        onClick={() => setUploadOpen((v) => !v)}
        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition"
      >
        ⬆ Upload Report
      </button>

      {uploadOpen && (
        <Card className="p-4">
          <div className="text-xs font-bold text-slate-800 mb-2">Upload report (.xlsx)</div>
          {!scopedClient && (
            <select
              value={uploadInvoiceId}
              onChange={(e) => setUploadInvoiceId(e.target.value)}
              className="dc-ctl w-full mb-2"
            >
              <option value="">Choose invoice…</option>
              {uploadInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.ocrData?.invoiceNo || inv.id.slice(0, 8)} · {inv.status}
                </option>
              ))}
            </select>
          )}
          {scopedClient && (
            <div className="text-[11px] text-slate-500 mb-2">
              {uploadInvoices[0]
                ? `Invoice: ${uploadInvoices[0].ocrData?.invoiceNo || uploadInvoices[0].id.slice(0, 8)} · ${uploadInvoices[0].status}`
                : "No open invoice — upload needs an invoice"}
            </div>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50">
            📎 Choose file
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                setUploadFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {uploadFile && (
            <span className="ml-2 text-[11px] text-slate-600">{uploadFile.name}</span>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={uploadReport}
              disabled={uploading || !uploadInvoiceId || !uploadFile}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              onClick={() => setUploadOpen(false)}
              className="text-xs text-slate-500 underline"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      <h2 className="text-sm font-bold text-slate-900">Report library</h2>
      <select
        value={outletFilter}
        onChange={(e) => setOutletFilter(e.target.value)}
        className="dc-ctl w-full max-w-md"
      >
        <option value="all">All outlets</option>
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
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
          <p className="text-sm text-slate-400 text-center py-8">
            No reports shared yet{outletName ? ` for ${outletName}` : ""}.
          </p>
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
                  {rep.outlet?.name || "No outlet"} ·{" "}
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
