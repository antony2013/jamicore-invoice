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
    <div className="min-h-screen bg-slate-50">
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/staff/dashboard"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" /> Back to My Invoices
          </Link>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                invoice.status === "collected"
                  ? "bg-emerald-100 text-emerald-800"
                  : invoice.status === "verified"
                  ? "bg-blue-100 text-blue-800"
                  : invoice.status === "in_review"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              Status: {invoice.status}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                        onClick={() => handleTransition("needs_info", "Staff requested additional info")}
                        disabled={saving}
                        className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition"
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
      </div>
    </div>
  );
}
