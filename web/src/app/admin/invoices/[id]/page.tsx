"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  Building,
  Hash,
  ShieldCheck,
  Clock,
  User,
  History,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

export default function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<any | null>(null);
  const [statusLogs, setStatusLogs] = useState<any[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadingImage, setReloadingImage] = useState(false);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [assignStaffId, setAssignStaffId] = useState("");
  const [assignPriority, setAssignPriority] = useState("normal");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [outletList, setOutletList] = useState<any[]>([]);
  const [outletId, setOutletId] = useState<string>("");
  const [savingOutlet, setSavingOutlet] = useState(false);
  const [outletMsg, setOutletMsg] = useState<string | null>(null);

  async function fetchImage() {
    setReloadingImage(true);
    try {
      const imgRes = await fetch(`/api/invoices/${id}/image-url`);
      const imgData = await imgRes.json();
      if (imgRes.ok && imgData.url) setImageUrl(imgData.url);
    } finally {
      setReloadingImage(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignStaffId) return;
    setAssigning(true);
    setAssignError(null);
    setAssignMsg(null);
    try {
      const res = await fetch(`/api/invoices/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: assignStaffId, priority: assignPriority }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assignment failed");
      setInvoice(data.invoice);
      setAssignMsg("Invoice assigned successfully.");
    } catch (err: any) {
      setAssignError(err.message);
    } finally {
      setAssigning(false);
    }
  }

  async function handleOutletSave() {
    setSavingOutlet(true);
    setOutletMsg(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId: outletId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update outlet");
      setInvoice(data.invoice);
      // Refresh outlet relation display
      const fresh = await fetch(`/api/invoices/${id}`);
      const freshData = await fresh.json();
      if (fresh.ok) setInvoice(freshData.invoice);
      setOutletMsg("Outlet updated.");
    } catch (err: any) {
      setOutletMsg(`Error: ${err.message}`);
    } finally {
      setSavingOutlet(false);
    }
  }

  useEffect(() => {
    async function fetchDetail() {
      setLoading(true);
      try {
        // 1. Fetch invoice & logs
        const res = await fetch(`/api/invoices/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load invoice");

        setInvoice(data.invoice);
        setStatusLogs(data.statusLogs || []);
        setOutletId(data.invoice.outletId || data.invoice.outlet?.id || "");

        // 2. Fetch fresh short-lived (5 min TTL) signed GET URL
        const imgRes = await fetch(`/api/invoices/${id}/image-url`);
        const imgData = await imgRes.json();
        if (imgRes.ok && imgData.url) {
          setImageUrl(imgData.url);
        }

        // 3. Staff list for assignment
        try {
          const staffRes = await fetch("/api/staff");
          const staffData = await staffRes.json();
          if (staffRes.ok && staffData.success) {
            setStaffList(staffData.staff || []);
            setAssignStaffId((prev) => prev || staffData.staff?.[0]?.id || "");
          }
        } catch {
          // Non-fatal: assignment form stays empty
        }

        // 4. Client's outlets for outlet assignment
        try {
          if (data.invoice?.clientId) {
            const outletRes = await fetch(`/api/outlets?clientId=${data.invoice.clientId}`);
            const outletData = await outletRes.json();
            if (outletRes.ok && outletData.success) {
              setOutletList(outletData.outlets || []);
            }
          }
        } catch {
          // Non-fatal
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
        Loading invoice details...
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full p-6 bg-white rounded-xl border border-red-200 text-center">
          <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-2" />
          <h2 className="text-base font-bold text-slate-900">Error loading invoice</h2>
          <p className="text-xs text-slate-500 mt-1">{error || "Invoice not found"}</p>
          <Link
            href="/admin/dashboard"
            className="mt-4 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Queue
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Invoice ID:</span>
            <span className="font-mono text-xs font-bold text-slate-900">{invoice.id}</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Private Image View */}
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Private Document Preview
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
                  <div className="border border-slate-100 rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center min-h-[420px]">
                    <img
                      src={imageUrl}
                      alt="Invoice Document"
                      className="max-h-[600px] w-auto object-contain"
                    />
                  </div>
                )
              ) : (
                <div className="h-64 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-400">
                  Preview unavailable or expired.
                </div>
              )}
              <div className="flex items-center justify-between mt-2">
                <p className="text-[11px] text-slate-400">
                  Storage Key: <code className="font-mono">{invoice.s3Key}</code>
                </p>
                <button
                  onClick={fetchImage}
                  disabled={reloadingImage}
                  className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-50"
                >
                  {reloadingImage ? "Reloading…" : "Reload preview"}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Details & Audit Trail */}
          <div className="lg:col-span-6 space-y-6">
            {/* Overview Card */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase ${
                      invoice.status === "collected"
                        ? "bg-emerald-100 text-emerald-800"
                        : invoice.status === "ocr_failed" || invoice.status === "disputed"
                        ? "bg-red-100 text-red-800"
                        : invoice.status === "ocr_done"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    Status: {invoice.status}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  Priority: <strong className="uppercase text-slate-800">{invoice.priority}</strong>
                </span>
              </div>

              {/* Client and Staff info */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs">
                <div>
                  <div className="text-slate-400 font-medium mb-1">Uploaded By (Client)</div>
                  <div className="font-semibold text-slate-800">{invoice.client?.name}</div>
                  <div className="text-slate-500">{invoice.client?.phone || invoice.client?.email}</div>
                  <div className="mt-1">
                    {invoice.outlet ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold">
                        ◍ {invoice.outlet.name}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic text-[11px]">No outlet</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-medium mb-1">Assigned Staff</div>
                  <div className="font-semibold text-slate-800">
                    {invoice.assignedStaff?.name || "Unassigned"}
                  </div>
                  <div className="text-slate-500">{invoice.assignedStaff?.email || "—"}</div>
                </div>
              </div>

              {/* Client Note */}
              {invoice.clientNote && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Client Note
                  </div>
                  <p className="text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    {invoice.clientNote}
                  </p>
                </div>
              )}

              {/* Per-page Notes */}
              {Array.isArray(invoice.pageNotes) && invoice.pageNotes.some((n: string) => n && n.trim()) && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    Page Notes
                  </div>
                  <div className="space-y-2">
                    {invoice.pageNotes.map((n: string, i: number) =>
                      n && n.trim() ? (
                        <div key={i} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                          <span className="font-bold text-slate-500">Page {i + 1}: </span>
                          <span className="text-slate-700">{n}</span>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              )}

              {/* OCR Extracted Data */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    OCR Extracted Data
                  </span>
                  {invoice.ocrData?.confidence && (
                    <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                      Confidence: {invoice.ocrData.confidence}%
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-400 mb-1 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" /> Amount
                    </div>
                    <div className="text-base font-bold text-slate-900">
                      ${invoice.ocrData?.amount || "0.00"}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-400 mb-1 flex items-center gap-1">
                      <Hash className="w-3.5 h-3.5" /> Invoice #
                    </div>
                    <div className="text-base font-bold text-slate-900">
                      {invoice.ocrData?.invoiceNo || "—"}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-400 mb-1 flex items-center gap-1">
                      <Building className="w-3.5 h-3.5" /> Vendor
                    </div>
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {invoice.ocrData?.vendor || "—"}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-400 mb-1 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> Date
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {invoice.ocrData?.date || "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Outlet Card */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Outlet
              </h3>
              {outletList.length === 0 ? (
                <p className="text-xs text-slate-400">
                  This client has no outlets yet.{" "}
                  <Link href="/admin/clients" className="text-blue-600 hover:underline">
                    Add one on the Clients page
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={outletId}
                    onChange={(e) => setOutletId(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
                  >
                    <option value="">No outlet (Unspecified)</option>
                    {outletList.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleOutletSave}
                    disabled={savingOutlet}
                    className="py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {savingOutlet ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
              {outletMsg && <p className="text-xs text-slate-600">{outletMsg}</p>}
            </div>

            {/* Assignment Card (Slice 3: detail view + assign + priority) */}
            {(invoice.status === "ocr_done" || invoice.status === "ocr_failed" || invoice.status === "assigned") && (
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {invoice.status === "assigned" ? "Re-assign Staff" : "Assign to Staff"}
                </h3>
                {assignMsg && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{assignMsg}</p>}
                {assignError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{assignError}</p>}
                <form onSubmit={handleAssign} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Staff member</label>
                    <select
                      value={assignStaffId}
                      onChange={(e) => setAssignStaffId(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-slate-50"
                    >
                      {staffList.filter((st) => st.role === "staff").map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.email}) — {st.role}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                    <select
                      value={assignPriority}
                      onChange={(e) => setAssignPriority(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-slate-50"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={assigning}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {assigning ? "Assigning…" : invoice.status === "assigned" ? "Confirm Re-assignment" : "Confirm Assignment"}
                  </button>
                </form>
              </div>
            )}

            {/* Audit Trail Timeline (Slice 5) */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-4 flex items-center gap-1.5">
                <History className="w-4 h-4 text-blue-600" />
                Audit Trail Timeline
              </h3>

              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {statusLogs.map((log, index) => (
                  <div key={log.id || index} className="relative">
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
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {log.actor ? `${log.actor.name} (${log.actor.role})` : "Automated System / Worker"}
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
