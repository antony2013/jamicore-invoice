"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, FileSpreadsheet, Save } from "lucide-react";

import AppShell from "@/components/AppShell";
import { shortInvoiceId } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Need to start",
  ocr_pending: "In progress",
  ocr_done: "In progress",
  ocr_failed: "Need to start",
  assigned: "In progress",
  in_review: "In progress",
  needs_info: "In progress",
  verified: "Verified",
  collected: "Finished",
  disputed: "Returned",
};

const NEXT_STATUS: Record<string, string> = {
  uploaded: "assigned",
  assigned: "in_review",
  needs_info: "in_review",
  in_review: "verified",
  verified: "collected",
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export default function StaffInvoiceVerifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [invoice, setInvoice] = useState<any | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState("");

  const [report, setReport] = useState<any | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);

  async function loadInvoiceData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invoice");

      setInvoice(data.invoice);
      const ocr = data.invoice.ocrData;
      setAmount(ocr?.amount ? String(ocr.amount) : "");
      setInvoiceNo(ocr?.invoiceNo || "");
      setVendor(ocr?.vendor || "");
      setDate(ocr?.date || "");

      await fetchImage();

      try {
        const repRes = await fetch(`/api/invoices/${id}/report`);
        const repData = await repRes.json();
        if (repRes.ok && repData.success) setReport(repData.report);
      } catch {
        // Report stays empty
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchImage() {
    try {
      const imgRes = await fetch(`/api/invoices/${id}/image-url`);
      const imgData = await imgRes.json();
      if (imgRes.ok && imgData.url) setImageUrl(imgData.url);
    } catch {
      // Preview stays empty
    }
  }

  useEffect(() => {
    loadInvoiceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSaveData(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    if (amount.trim() && !Number.isFinite(Number(amount.trim()))) {
      setError("Amount must be a valid number.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocrData: {
            amount: amount ? parseFloat(amount) : null,
            invoiceNo,
            vendor,
            date,
          },
          expectedUpdatedAt: invoice?.updatedAt ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save updates");
      setSuccess("Invoice data saved.");
      loadInvoiceData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTransition(targetStatus: string, actionNote: string) {
    if (!invoice) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          ocrData: {
            amount: amount ? parseFloat(amount) : null,
            invoiceNo,
            vendor,
            date,
          },
          note: actionNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setSuccess(`Status updated to ${STATUS_LABELS[targetStatus] ?? targetStatus}.`);
      loadInvoiceData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateReport() {
    setReportBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate report");
      setReport(data.report);
      setSuccess("Report generated.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function handleDownloadReport() {
    setReportBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}/report`);
      const data = await res.json();
      if (!res.ok || !data.report?.downloadUrl) throw new Error(data.error || "No report available");
      setReport(data.report);
      window.open(data.report.downloadUrl, "_blank", "noopener");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function handleUploadReport() {
    if (!reportFile) return;
    if (!reportFile.name.toLowerCase().endsWith(".xlsx")) {
      setError("Report must be an .xlsx file.");
      return;
    }
    setReportBusy(true);
    setError(null);
    try {
      const urlRes = await fetch(`/api/invoices/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upload-url", contentLength: reportFile.size }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare upload");
      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: reportFile,
      });
      if (!putRes.ok) throw new Error("Report upload to storage failed.");
      const confRes = await fetch(`/api/invoices/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          s3Key: urlData.s3Key,
          fileName: reportFile.name,
        }),
      });
      const confData = await confRes.json();
      if (!confRes.ok) throw new Error(confData.error || "Failed to attach report");
      setReport(confData.report);
      setReportFile(null);
      setSuccess("Report uploaded.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
        Loading invoice…
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full p-6 bg-white rounded-xl border border-red-200 text-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
          <h2 className="text-base font-bold text-slate-900">Error</h2>
          <p className="text-xs text-slate-500 mt-1">{error || "Invoice not found"}</p>
          <Link
            href="/staff/dashboard"
            className="mt-4 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-3 h-3" /> Back to My Invoices
          </Link>
        </div>
      </div>
    );
  }

  const isTerminal = invoice.status === "collected" || invoice.status === "disputed";
  const statusLabel = STATUS_LABELS[invoice.status] ?? invoice.status;
  const nextStatus = NEXT_STATUS[invoice.status];
  const canReturn = invoice.status === "in_review";
  const canFlag = invoice.status === "verified";
  const reportName = report?.fileName;

  return (
    <AppShell role="staff" title={`Invoice ${shortInvoiceId(invoice)}`} hideHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
            Invoice Preview
          </span>
          <span className="text-[11px] text-slate-400">
            Updated {formatDate(invoice.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              handleTransition("needs_info", "Staff returned invoice for more information")
            }
            disabled={!canReturn || saving || isTerminal}
            className="px-3.5 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Return
          </button>
          <button
            onClick={() => handleTransition("disputed", "Invoice flagged")}
            disabled={!canFlag || saving || isTerminal}
            className="px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Flag
          </button>
          <button
            onClick={() =>
              nextStatus &&
              handleTransition(
                nextStatus,
                nextStatus === "verified"
                  ? "Staff verified invoice data accuracy"
                  : nextStatus === "collected"
                    ? "Payment successfully collected"
                    : "Advanced to next stage"
              )
            }
            disabled={!nextStatus || saving || isTerminal}
            className="px-3.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next
          </button>
          <Link
            href="/staff/dashboard"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to My Invoices
          </Link>
        </div>
      </div>

      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-3">
            {imageUrl ? (
              invoice.s3Key?.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={imageUrl}
                  title="Invoice Document (PDF)"
                  className="w-full min-h-[720px] rounded"
                />
              ) : (
                <img
                  src={imageUrl}
                  alt="Invoice Document"
                  className="w-full max-h-[820px] object-contain rounded"
                />
              )
            ) : (
              <div className="h-[720px] bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400">
                Preview loading or expired.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-t-xl bg-slate-900 px-4 py-3 text-white">
            <div className="text-[13px] font-bold">Status: {statusLabel}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">
              {isTerminal
                ? "This invoice has concluded its lifecycle."
                : "This invoice is still in progress."}
            </div>
          </div>

          <div className="rounded-xl border border-[#E4E7EC] bg-white p-4 -mt-4">
            <h3 className="text-[13px] font-bold text-slate-900 mb-3">
              Verified &amp; Correct Invoice Data
            </h3>

            <form onSubmit={handleSaveData} className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Status</span>
                <span className="flex-1 text-right sm:text-left">
                  <span className="inline-flex px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">
                    {statusLabel}
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Invoice number</span>
                <input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  disabled={isTerminal || saving}
                  placeholder="—"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs font-semibold text-slate-800 disabled:bg-slate-50"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Invoice date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={isTerminal || saving}
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs text-slate-800 disabled:bg-slate-50"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Vendor / Supplier</span>
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  disabled={isTerminal || saving}
                  placeholder="—"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs text-slate-800 disabled:bg-slate-50"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Currency</span>
                <span className="flex-1 text-right text-xs font-semibold text-slate-800">
                  MVR
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">Total</span>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isTerminal || saving}
                  placeholder="0.00"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs font-bold text-slate-900 disabled:bg-slate-50"
                />
              </div>

              {!isTerminal && (
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-2 w-full py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save changes"}
                </button>
              )}
            </form>
          </div>

          <div className="rounded-xl border border-[#E4E7EC] bg-white p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-3">
              Excel report for client
            </h3>

            {report ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="h-8 w-8 rounded-md bg-white border border-emerald-200 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-emerald-900 truncate">
                    {reportName}
                  </div>
                  <div className="text-[10px] text-emerald-700">
                    {formatDate(report.createdAt)}
                  </div>
                </div>
                <button
                  onClick={handleDownloadReport}
                  disabled={reportBusy}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold disabled:opacity-50"
                >
                  View
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">No report shared yet.</p>
            )}

            <div className="mt-3 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600">
                Insert report PDF / Excel
              </div>
              <div className="flex items-center gap-2">
                <label className="flex-1 min-w-0 cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 truncate hover:bg-slate-100">
                  <span className="font-semibold text-slate-700">Choose file</span>
                  <span className="ml-2 text-slate-400">
                    {reportFile ? reportFile.name : "No file chosen"}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => setReportFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={handleUploadReport}
                  disabled={reportBusy || !reportFile}
                  className="px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold disabled:opacity-40 whitespace-nowrap"
                >
                  Upload
                </button>
              </div>
              <button
                onClick={handleGenerateReport}
                disabled={reportBusy}
                className="w-full py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-semibold disabled:opacity-50"
              >
                {reportBusy ? "Working…" : "Generate from invoice data"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
