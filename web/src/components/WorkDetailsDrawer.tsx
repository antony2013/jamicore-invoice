"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileUp, Plus, Trash2, X } from "lucide-react";

/** One draft line in the Work Details panel. */
type WorkLine = {
  key: string;
  category: string;
  description: string;
  quantity: string;
  rate: string;
  discountPercent: string;
};

const WORK_CATEGORIES = [
  "Accounting",
  "Design",
  "Development",
  "Consulting",
  "Other",
];

const TAX_PERCENT = 5;

function money(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString("en-US", { maximumFractionDigits: 3 })} KWD`;
}

function newLine(): WorkLine {
  return {
    key: Math.random().toString(36).slice(2),
    category: "Accounting",
    description: "",
    quantity: "1",
    rate: "0",
    discountPercent: "0",
  };
}

function lineTotals(line: WorkLine) {
  const qty = Math.max(0, Number(line.quantity) || 0);
  const rate = Math.max(0, Number(line.rate) || 0);
  const discountPct = Math.min(100, Math.max(0, Number(line.discountPercent) || 0));
  const subtotal = qty * rate;
  const discount = (subtotal * discountPct) / 100;
  const tax = ((subtotal - discount) * TAX_PERCENT) / 100;
  return { subtotal, discount, tax, amount: subtotal - discount + tax };
}

/**
 * Work Details side panel for the client page. Each saved line becomes a
 * `service` client record; the panel's totals are recomputed from those rows.
 */
export default function WorkDetailsDrawer({
  clientId,
  open,
  onClose,
  onSaved,
  savedGrandTotal,
  amountPaid,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  savedGrandTotal: number;
  amountPaid: number;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<WorkLine[]>([newLine()]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const totals = lines.reduce(
    (acc, line) => {
      const t = lineTotals(line);
      acc.subtotal += t.subtotal;
      acc.discount += t.discount;
      acc.tax += t.tax;
      acc.amount += t.amount;
      return acc;
    },
    { subtotal: 0, discount: 0, tax: 0, amount: 0 }
  );
  const projectedGrand = savedGrandTotal + totals.amount;
  const balanceDue = Math.max(0, projectedGrand - amountPaid);
  const paymentStatus =
    projectedGrand <= 0
      ? amountPaid > 0
        ? "Advance Paid"
        : "Unpaid"
      : amountPaid >= projectedGrand - 0.0005
        ? "Paid"
        : amountPaid > 0
          ? "Partially Paid"
          : "Unpaid";

  function updateLine(key: string, patch: Partial<WorkLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function saveWork() {
    const filled = lines.filter((l) => l.description.trim());
    if (filled.length === 0) {
      setError("Add a description for at least one work item.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const line of filled) {
        const t = lineTotals(line);
        const res = await fetch("/api/client-records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            type: "service",
            title: line.description.trim().slice(0, 200),
            amount: Number(t.amount.toFixed(3)),
            recordDate: date || null,
            status: "active",
            workCategory: line.category,
            quantity: Number(line.quantity) || 0,
            rate: Number(line.rate) || 0,
            discountPercent: Number(line.discountPercent) || 0,
            taxPercent: TAX_PERCENT,
            description: notes.trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not save work details.");
      }
      setLines([newLine()]);
      setNotes("");
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || "Could not save work details.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label="Work Details"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Work Details</h2>
            <p className="text-[11px] text-slate-500">Client work items and payment summary</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-semibold text-slate-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close work details"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Work Category</th>
                <th className="px-2 py-2 text-left font-semibold">Description</th>
                <th className="w-16 px-1 py-2 text-right font-semibold">Qty / Hours</th>
                <th className="w-20 px-1 py-2 text-right font-semibold">Rate (KWD)</th>
                <th className="w-16 px-1 py-2 text-right font-semibold">Discount %</th>
                <th className="w-20 px-1 py-2 text-right font-semibold">Amount</th>
                <th className="w-8 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => {
                const t = lineTotals(line);
                return (
                  <tr key={line.key} className="align-top">
                    <td className="px-2 py-1.5">
                      <select
                        value={line.category}
                        onChange={(e) => updateLine(line.key, { category: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none"
                      >
                        {WORK_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="Monthly bookkeeping"
                        className="w-full rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1 py-1 text-right text-[11px] outline-none"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={line.rate}
                        onChange={(e) => updateLine(line.key, { rate: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1 py-1 text-right text-[11px] outline-none"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={line.discountPercent}
                        onChange={(e) => updateLine(line.key, { discountPercent: e.target.value })}
                        className="w-full rounded border border-slate-200 px-1 py-1 text-right text-[11px] outline-none"
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold text-slate-800">
                      {t.amount.toFixed(3)}
                    </td>
                    <td className="py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length > 1 ? prev.filter((l) => l.key !== line.key) : prev
                          )
                        }
                        aria-label="Remove work item"
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, newLine()])}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add Work Item
        </button>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-700">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes…"
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-700">Attachments</span>
              <Link
                href={`/admin/clients/${clientId}/reports`}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <FileUp className="h-3.5 w-3.5" /> Upload File
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-900">{money(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-600">Discount Total</span>
              <span className="font-medium text-slate-900">−{money(totals.discount)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-600">Tax Total (5%)</span>
              <span className="font-medium text-slate-900">{money(totals.tax)}</span>
            </div>
            <div className="my-1.5 flex items-center justify-between border-y border-slate-200 py-1.5">
              <span className="font-bold text-slate-900">Grand Total</span>
              <span className="font-bold text-blue-700">{money(projectedGrand)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-600">Amount Paid</span>
              <span className="font-medium text-emerald-700">{money(amountPaid)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-slate-600">Balance Due</span>
              <span className="font-semibold text-amber-700">{money(balanceDue)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-600">Payment Status</span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  paymentStatus === "Paid"
                    ? "bg-emerald-100 text-emerald-700"
                    : paymentStatus === "Partially Paid"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-200 text-slate-700"
                }`}
              >
                {paymentStatus}
              </span>
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={saveWork}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save work"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
