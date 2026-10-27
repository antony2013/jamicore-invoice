"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, ChevronDown } from "lucide-react";

import AppShell from "@/components/AppShell";
import ChatWidget from "@/components/ChatWidget";
import { shortInvoiceId } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Need to start",
  ocr_pending: "Processing",
  ocr_done: "Processing",
  ocr_failed: "Need to start",
  assigned: "Processing",
  in_review: "Processing",
  needs_info: "Processing",
  verified: "Verified",
  collected: "Finished",
  disputed: "Returned",
};

const STATUS_PILL: Record<string, string> = {
  uploaded: "bg-amber-50 text-amber-700 ring-amber-200",
  ocr_failed: "bg-amber-50 text-amber-700 ring-amber-200",
  ocr_pending: "bg-blue-50 text-blue-700 ring-blue-200",
  ocr_done: "bg-blue-50 text-blue-700 ring-blue-200",
  assigned: "bg-blue-50 text-blue-700 ring-blue-200",
  in_review: "bg-blue-50 text-blue-700 ring-blue-200",
  needs_info: "bg-blue-50 text-blue-700 ring-blue-200",
  verified: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  collected: "bg-slate-100 text-slate-700 ring-slate-300",
  disputed: "bg-red-50 text-red-700 ring-red-200",
};

// Working-status update path: the pill is a dropdown. Each option mirrors the
// server transition matrix (invoice-transitions.ts) — no illegal moves shown.
const NEXT_OPTIONS: Record<string, { status: string; label: string; note: string }[]> = {
  uploaded: [{ status: "assigned", label: "Start processing", note: "Invoice processing started" }],
  assigned: [{ status: "in_review", label: "Start review", note: "Invoice moved to review" }],
  in_review: [
    { status: "verified", label: "Verify — data checked", note: "Staff verified invoice data accuracy" },
    { status: "needs_info", label: "Need more info", note: "Staff returned invoice for more information" },
  ],
  needs_info: [{ status: "in_review", label: "Resume review", note: "Review resumed after more info" }],
  verified: [
    { status: "collected", label: "Collected — finished", note: "Payment successfully collected" },
    { status: "disputed", label: "Flag as disputed", note: "Invoice disputed" },
  ],
  disputed: [
    { status: "in_review", label: "Re-open — pick back up", note: "Invoice re-opened from Returned" },
  ],
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function loadInvoiceData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invoice");

      setInvoice(data.invoice);

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
      if (imgRes.ok && imgData.url) setImageUrl(imgData.url);
    } catch {
      // Preview stays empty
    }
  }

  useEffect(() => {
    loadInvoiceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateStatus(targetStatus: string, actionNote: string) {
    if (!invoice || saving) return;
    setSaving(true);
    setMenuOpen(false);
    setError(null);
    try {
      // Transitions only — no ocrData here. Sending money fields would make
      // every PATCH a "money edit", which 403s staff on verified invoices
      // ("Verified invoices are locked for staff").
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus, note: actionNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
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

  const statusLabel = STATUS_LABELS[invoice.status] ?? invoice.status;
  const statusPill = STATUS_PILL[invoice.status] ?? "bg-slate-100 text-slate-600 ring-slate-300";

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
          {/* Status pill doubles as the working-status control: click it,
              pick the next step, done. Read-only in terminal states. */}
          {(() => {
            const options = NEXT_OPTIONS[invoice.status] ?? [];
            if (options.length === 0) {
              return (
                <span
                  className={`inline-flex items-center rounded-full ring-1 px-3.5 py-1.5 text-[11px] font-semibold ${statusPill}`}
                >
                  {statusLabel}
                </span>
              );
            }
            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 rounded-full ring-1 px-3.5 py-1.5 text-[11px] font-semibold transition hover:brightness-95 disabled:opacity-60 ${statusPill}`}
                >
                  {statusLabel}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {menuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close status menu"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                      {options.map((opt) => (
                        <button
                          key={opt.status}
                          type="button"
                          disabled={saving}
                          onClick={() => updateStatus(opt.status, opt.note)}
                          className="block w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <Link
            href={
              invoice.clientId && (invoice.outletId || invoice.outlet?.id)
                ? `/staff/clients/${invoice.clientId}/outlets/${invoice.outletId || invoice.outlet?.id}`
                : invoice.clientId
                  ? `/staff/clients/${invoice.clientId}`
                  : "/staff/dashboard"
            }
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to My Invoices
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

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

      <ChatWidget
        clientId={invoice.clientId}
        scopeId={invoice.outletId || invoice.outlet?.id || "none"}
        outletLabel={invoice.outlet?.name ?? "No outlet"}
        invoices={[{ id: invoice.id, label: shortInvoiceId(invoice) }]}
        initialScopeType="invoice"
      />
    </AppShell>
  );
}