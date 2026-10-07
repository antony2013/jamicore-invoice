"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  DollarSign,
  Building,
  Hash,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Save,
  Clock,
  History,
  FileCheck,
} from "lucide-react";
import AppShell from "@/components/AppShell";

export default function StaffInvoiceVerifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [invoice, setInvoice] = useState<any | null>(null);
  const [statusLogs, setStatusLogs] = useState<any[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields
  const [amount, setAmount] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  // Client↔staff thread
  const [messages, setMessages] = useState<any[]>([]);
  const [msgBody, setMsgBody] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  // Excel report (office work product → client downloads it)
  const [report, setReport] = useState<any | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);

  const STAFF_DELETABLE = ["assigned", "in_review", "needs_info"];
  const canDelete = !!invoice && STAFF_DELETABLE.includes(invoice.status);

  async function handleDelete() {
    if (!invoice) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    if (deleteReason.trim().length < 5) {
      setError("Give a reason of at least 5 characters to delete.");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete invoice");
      window.location.href = "/staff/dashboard";
    } catch (err: any) {
      setError(err.message);
      setDeleteArmed(false);
    } finally {
      setDeleting(false);
    }
  }

  async function loadInvoiceData() {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch invoice & logs
      const res = await fetch(`/api/invoices/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invoice");

      setInvoice(data.invoice);
      setStatusLogs(data.statusLogs || []);

      // Populate editable fields
      const ocr = data.invoice.ocrData;
      setAmount(ocr?.amount ? String(ocr.amount) : "");
      setInvoiceNo(ocr?.invoiceNo || "");
      setVendor(ocr?.vendor || "");
      setDate(ocr?.date || "");

      // 2. Fetch fresh short-lived signed GET URL (5 min TTL)
      await fetchImage();

      // 3. Thread + current Excel report (independent — never block the page)
      try {
        const [msgRes, repRes] = await Promise.all([
          fetch(`/api/invoices/${id}/messages`),
          fetch(`/api/invoices/${id}/report`),
        ]);
        const msgData = await msgRes.json();
        const repData = await repRes.json();
        if (msgRes.ok && msgData.success) setMessages(msgData.messages || []);
        if (repRes.ok && repData.success) setReport(repData.report);
      } catch {
        // Thread/report stay empty; invoice work is unaffected
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
      if (imgRes.ok && imgData.url) {
        setImageUrl(imgData.url);
      }
    } catch {
      // Preview stays empty with reload affordance
    }
  }

  useEffect(() => {
    loadInvoiceData();
  }, [id]);

  // Handle saving corrections without changing status
  // Sends `note` only when staff typed one, so routine saves don't spam
  // the audit timeline (backend logs data-edits only with explicit notes).
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
          ...(note ? { note: `Data verified/corrected by staff: ${note}` } : {}),
          expectedUpdatedAt: invoice?.updatedAt ?? undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save updates");

      setSuccess("Invoice data successfully saved!");
      loadInvoiceData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Handle status transition
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

      setSuccess(`Status transitioned to '${targetStatus}'!`);
      loadInvoiceData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // "Needs info" carries the typed question to the client: the message box
  // text (when present) becomes BOTH the thread message AND the status note,
  // so the client sees exactly what is being asked — no more dead end.
  async function handleNeedsInfo() {
    const question = msgBody.trim() || "Staff requested additional info";
    setMsgSending(true);
    setError(null);
    try {
      const msgRes = await fetch(`/api/invoices/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: question }),
      });
      const msgData = await msgRes.json();
      if (!msgRes.ok) throw new Error(msgData.error || "Failed to send message");
      await handleTransition("needs_info", question);
      setMsgBody("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMsgSending(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setMsgSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: msgBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");
      setMsgBody("");
      setMessages((prev) => [data.message, ...prev]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMsgSending(false);
    }
  }

  // Excel report: Generate (server builds from invoice data) or Upload
  // (staff .xlsx file → presigned PUT → confirm replaces current report).
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
      setSuccess("Excel report generated — the client can download it now.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  // Fresh download URL on every click (links live 5 minutes)
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
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        body: reportFile,
      });
      if (!putRes.ok) throw new Error("Report upload to storage failed.");
      const confRes = await fetch(`/api/invoices/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", s3Key: urlData.s3Key, fileName: reportFile.name }),
      });
      const confData = await confRes.json();
      if (!confRes.ok) throw new Error(confData.error || "Failed to attach report");
      setReport(confData.report);
      setReportFile(null);
      setSuccess("Excel report uploaded — the client can download it now.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
        Loading verification workspace...
      </div>
    );
  }

  if (error || !invoice) {
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
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const isTerminal = invoice.status === "collected" || invoice.status === "disputed";
  const fieldConf = invoice.ocrData?.fieldConfidence || {};

  return (
    <AppShell
      role="staff"
      title={`Verify ${invoice.invoiceNo || invoice.id.substring(0, 8)}`}
      subtitle={`${invoice.client?.name || "Unknown client"} — Status: ${invoice.status}`}
      actions={
        <Link href="/staff/dashboard" className="dc-btn">
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> Back to My Invoices
        </Link>
      }
    >
        {/* Messages */}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Side-by-side Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Private Document Viewer */}
          <div className="lg:col-span-6">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm sticky top-24">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Document Preview (Private S3)
                </h3>
                <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Signed GET URL (5 min TTL)
                </span>
              </div>

              {imageUrl ? (
                invoice.s3Key?.toLowerCase().endsWith(".pdf") ? (
                  <div className="border border-slate-100 rounded-lg overflow-hidden bg-white min-h-[600px]">
                    <iframe
                      src={imageUrl}
                      title="Invoice Document (PDF)"
                      className="w-full min-h-[600px]"
                    />
                  </div>
                ) : (
                  <div className="border border-slate-100 rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center min-h-[500px]">
                    <img
                      src={imageUrl}
                      alt="Invoice Document"
                      className="max-h-[640px] w-auto object-contain"
                    />
                  </div>
                )
              ) : (
                <div className="h-96 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-400">
                  Preview loading or expired.
                </div>
              )}
              <button
                onClick={fetchImage}
                className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline"
              >
                Reload preview (fresh 5-min URL)
              </button>
            </div>
          </div>

          {/* Right: Verification Form & Status Flow Actions */}
          <div className="lg:col-span-6 space-y-6">
            {/* Outlet badge */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-medium">Outlet:</span>
              {invoice.outlet ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold">
                  ◍ {invoice.outlet.name}
                </span>
              ) : (
                <span className="text-slate-400 italic">No outlet specified</span>
              )}
              <span className="text-slate-400 font-medium ml-2">Uploaded by:</span>
              {invoice.uploadedBy ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-700 text-[11px] font-semibold">
                  📤 {invoice.uploadedBy.name} (team)
                </span>
              ) : (
                <span className="text-slate-500">📤 Owner</span>
              )}
            </div>
            {/* OCR-failed banner: explains blank fields */}
            {invoice && (invoice.status === "assigned" || invoice.status === "in_review") && !invoice.ocrData && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-900">No extracted data yet</h4>
                  <p className="text-xs text-amber-800">
                    Automatic extraction failed or is pending — please enter the invoice fields manually below.
                  </p>
                </div>
              </div>
            )}
            {/* Client Note from mobile upload */}
            {invoice.clientNote && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <h4 className="text-sm font-bold text-amber-900 mb-1">Client Note</h4>
                <p className="text-xs text-amber-800">{invoice.clientNote}</p>
              </div>
            )}
            {/* Per-page Notes */}
            {Array.isArray(invoice.pageNotes) && invoice.pageNotes.some((n: string) => n && n.trim()) && (
              <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                <h4 className="text-sm font-bold text-slate-900 mb-2">Page Notes</h4>
                <div className="space-y-2">
                  {invoice.pageNotes.map((n: string, i: number) =>
                    n && n.trim() ? (
                      <p key={i} className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                        <strong>Page {i + 1}:</strong> {n}
                      </p>
                    ) : null
                  )}
                </div>
              </div>
            )}
            {/* Terminal State Banner */}            {isTerminal && (
              <div className="p-4 bg-slate-900 text-white rounded-xl flex items-center gap-3">
                <Lock className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold">Terminal State: {invoice.status}</h4>
                  <p className="text-xs text-slate-300">
                    This invoice has concluded its lifecycle. No further edits or status transitions are allowed.
                  </p>
                </div>
              </div>
            )}

            {/* Editable OCR Fields */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-blue-600" />
                  Verify & Correct Invoice Data
                </h3>
                {invoice.ocrData?.confidence && (
                  <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                    Overall OCR Confidence: {invoice.ocrData.confidence}%
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveData} className="space-y-4">
                {/* Total Amount */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">Total Amount ($)</label>
                    {fieldConf.amount && fieldConf.amount < 80 && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Confidence ({fieldConf.amount}%)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      disabled={isTerminal || saving}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 pl-9 border border-slate-300 rounded-lg text-sm font-bold text-slate-900 disabled:bg-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* Invoice Number */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">Invoice Number</label>
                    {fieldConf.invoiceNo && fieldConf.invoiceNo < 80 && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Confidence ({fieldConf.invoiceNo}%)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      disabled={isTerminal || saving}
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      placeholder="INV-00000"
                      className="w-full px-3 py-2 pl-9 border border-slate-300 rounded-lg text-sm font-mono disabled:bg-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* Vendor / Supplier */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">Vendor / Supplier</label>
                    {fieldConf.vendor && fieldConf.vendor < 80 && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Confidence ({fieldConf.vendor}%)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      disabled={isTerminal || saving}
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      placeholder="e.g. Acme Supplies"
                      className="w-full px-3 py-2 pl-9 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Building className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* Date */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">Invoice Date</label>
                    {fieldConf.date && fieldConf.date < 80 && (
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Confidence ({fieldConf.date}%)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="date"
                      disabled={isTerminal || saving}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-3 py-2 pl-9 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {/* Optional Note */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Audit Note</label>
                  <input
                    type="text"
                    disabled={isTerminal || saving}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Confirmed vendor against customer contract"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs disabled:bg-slate-100 outline-none"
                  />
                </div>

                {!isTerminal && (
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Field Corrections"}
                  </button>
                )}
              </form>
            </div>

            {/* Dynamic Status Transition Buttons (Strict Transition Table) */}
            {!isTerminal && (
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                  Allowed Workflow Actions
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  Actions are restricted strictly to valid state machine transitions from{" "}
                  <strong>{invoice.status}</strong>.
                </p>

                <div className="space-y-2">
                  {/* From 'assigned' -> 'in_review' */}
                  {invoice.status === "assigned" && (
                    <button
                      onClick={() => handleTransition("in_review", "Staff started review process")}
                      disabled={saving}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
                    >
                      Start Review &rarr; in_review
                    </button>
                  )}

                  {/* From 'in_review' -> 'needs_info' or 'verified' */}
                  {invoice.status === "in_review" && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={handleNeedsInfo}
                        disabled={saving || msgSending}
                        className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition"
                        title="Type the question in the message box below first — it goes to the client with this status"
                      >
                        Needs Info &rarr; needs_info
                      </button>
                      <button
                        onClick={() => handleTransition("verified", "Staff verified invoice data accuracy")}
                        disabled={saving}
                        className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                      >
                        Verify Invoice &rarr; verified
                      </button>
                    </div>
                  )}

                  {/* From 'needs_info' -> 'in_review' */}
                  {invoice.status === "needs_info" && (
                    <button
                      onClick={() => handleTransition("in_review", "Staff resumed review with updated information")}
                      disabled={saving}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
                    >
                      Resume Review &rarr; in_review
                    </button>
                  )}

                  {/* From 'verified' -> 'collected' or 'disputed' (Terminal) */}
                  {invoice.status === "verified" && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleTransition("collected", "Payment successfully collected")}
                        disabled={saving}
                        className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                      >
                        Mark Collected (Terminal)
                      </button>
                      <button
                        onClick={() => handleTransition("disputed", "Invoice disputed by client or vendor")}
                        disabled={saving}
                        className="py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition"
                      >
                        Mark Disputed (Terminal)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Danger Zone: staff delete only in pre-verification states */}
            {canDelete && (
              <div className="bg-white p-6 rounded-xl border border-red-200 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-wider text-red-700 mb-2">
                  Danger Zone
                </h3>
                {deleteArmed && (
                  <input
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="Reason for deleting (min 5 chars) *"
                    maxLength={200}
                    className="w-full mb-2 px-3 py-2 border border-red-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-red-400"
                  />
                )}
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={`w-full py-2 px-4 rounded-lg text-xs font-medium disabled:opacity-50 ${
                    deleteArmed
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : "border border-red-300 text-red-700 hover:bg-red-50"
                  }`}
                >
                  {deleting
                    ? "Deleting…"
                    : deleteArmed
                      ? "Confirm delete with reason"
                      : "Delete Invoice"}
                </button>
              </div>
            )}

            {/* Excel Report: office work product the client downloads */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-1.5">
                📊 Excel Report for Client
              </h3>
              {report ? (
                <div className="flex items-center justify-between gap-2 mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="text-xs">
                    <div className="font-bold text-emerald-900">{report.fileName}</div>
                    <div className="text-emerald-700">
                      {report.source === "generated" ? "Auto-generated" : "Staff upload"} ·{" "}
                      {new Date(report.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {report.downloadUrl && (
                    <button
                      onClick={handleDownloadReport}
                      disabled={reportBusy}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      Download
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400 mb-3">No report shared yet.</p>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleGenerateReport}
                  disabled={reportBusy}
                  className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {reportBusy ? "Working…" : "⚡ Generate from invoice data"}
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => setReportFile(e.target.files?.[0] || null)}
                    className="flex-1 text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:text-xs file:font-medium hover:file:bg-slate-100"
                  />
                  <button
                    onClick={handleUploadReport}
                    disabled={reportBusy || !reportFile}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                  >
                    Upload .xlsx
                  </button>
                </div>
              </div>
            </div>

            {/* Client↔staff conversation thread */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1.5">
                💬 Client Conversation
              </h3>
              <p className="text-[11px] text-slate-400 mb-3">
                {invoice.status === "in_review"
                  ? "Type the question here first, then press Needs Info above — it goes to the client."
                  : "Replies from the client appear here. For Needs Info, switch the invoice back to that status first."}
              </p>
              <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-xs text-slate-400">No messages yet.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-2.5 rounded-lg text-xs max-w-[90%] ${
                        m.senderType === "staff"
                          ? "ml-auto bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      <div className={`font-bold mb-0.5 ${m.senderType === "staff" ? "text-blue-100" : "text-slate-500"}`}>
                        {m.senderName}
                        {m.kind === "request_report" && " · 📄 requested the report"}
                      </div>
                      <div>{m.body}</div>
                      <div className={`mt-1 text-[10px] ${m.senderType === "staff" ? "text-blue-200" : "text-slate-400"}`}>
                        {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Write to the client… (max 500)"
                  maxLength={500}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={msgSending || !msgBody.trim()}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>

            {/* Audit Trail Timeline (Slice 5) */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-4 flex items-center gap-1.5">
                <History className="w-4 h-4 text-blue-600" />
                Status History & Audit Trail
              </h3>
              <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {statusLogs.map((log) => (
                  <div key={log.id} className="relative">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-800">
                          {log.status}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{log.note}</p>
                      <div className="text-[10px] text-slate-400 mt-1">
                        Actor: {log.actor ? `${log.actor.name} (${log.actor.role})` : "Automated System"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AppShell>
  );
}
