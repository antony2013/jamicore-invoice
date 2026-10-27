"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";

import AppShell from "@/components/AppShell";
import ChatWidget from "@/components/ChatWidget";
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

  async function handleTransition(targetStatus: string, actionNote: string) {
    if (!invoice) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Transitions only — no ocrData here. Sending money fields would make
      // every PATCH a "money edit", which 403s staff on verified invoices
      // ("Verified invoices are locked for staff").
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
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