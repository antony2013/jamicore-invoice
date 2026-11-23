"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import AppShell from "@/components/AppShell";
import WorkDetailsDrawer from "@/components/WorkDetailsDrawer";
import { CLIENT_RECORD_STATUS_LABELS } from "@/lib/client-records";

function money(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString("en-US", { maximumFractionDigits: 3 })} KWD`;
}

/** Payment details for one client — opened from the client side menu. */
export default function AdminClientPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showWorkDrawer, setShowWorkDrawer] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [payDraft, setPayDraft] = useState({
    title: "",
    amount: "0",
    recordDate: "",
    status: "paid",
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientsRes, recordsRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/client-records?clientId=${encodeURIComponent(id)}`),
      ]);
      const clientsData = await clientsRes.json();
      const recordsData = await recordsRes.json();
      if (!clientsRes.ok || !recordsRes.ok) {
        throw new Error(clientsData.error || recordsData.error || "Failed to load payment details");
      }
      setClient((clientsData.clients ?? []).find((c: any) => c.id === id) ?? null);
      setRecords(recordsData.records ?? []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load payment details.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const workRecords = records.filter(
    (r) => r.type === "service" && r.status !== "cancelled"
  );
  const subtotal = workRecords.reduce((sum, r) => {
    const base = Number(r.quantity || 0) * Number(r.rate || 0);
    return sum + (base > 0 ? base : Number(r.amount || 0));
  }, 0);
  const discountTotal = workRecords.reduce((sum, r) => {
    const base = Number(r.quantity || 0) * Number(r.rate || 0);
    return sum + (base > 0 ? (base * Number(r.discountPercent || 0)) / 100 : 0);
  }, 0);
  const taxTotal = workRecords.reduce((sum, r) => {
    const base = Number(r.quantity || 0) * Number(r.rate || 0);
    if (base <= 0) return sum;
    const discount = (base * Number(r.discountPercent || 0)) / 100;
    return sum + ((base - discount) * Number(r.taxPercent ?? 5)) / 100;
  }, 0);
  const grandTotal = workRecords.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const paymentRecords = records
    .filter((r) => r.type === "payment")
    .sort(
      (a, b) =>
        new Date(b.recordDate || b.createdAt).getTime() -
        new Date(a.recordDate || a.createdAt).getTime()
    );
  const amountPaid = paymentRecords
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const balanceDue = Math.max(0, grandTotal - amountPaid);
  const paymentStatus =
    grandTotal <= 0
      ? amountPaid > 0
        ? "Advance Paid"
        : "Unpaid"
      : amountPaid >= grandTotal - 0.0005
        ? "Paid"
        : amountPaid > 0
          ? "Partially Paid"
          : "Unpaid";

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setSavingPayment(true);
    setPaymentError(null);
    try {
      const res = await fetch("/api/client-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: id,
          type: "payment",
          title: payDraft.title.trim() || "Payment received",
          amount: Number(payDraft.amount) || 0,
          recordDate: payDraft.recordDate || null,
          status: payDraft.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save payment.");
      setPayDraft({ title: "", amount: "0", recordDate: "", status: "paid" });
      setShowPaymentForm(false);
      await load();
    } catch (err: any) {
      setPaymentError(err.message || "Could not save payment.");
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <AppShell role="admin" title={`${client?.name ?? "Client"} · Payment`} subtitle="Work details and payments">
      <div className="w-full">
        <Link
          href={`/admin/clients/${id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to client
        </Link>

        {loadError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Payment details</h2>
              <p className="text-[11px] text-slate-500">
                {loading ? "Loading…" : client?.name ?? "Client"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowWorkDrawer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add work
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subtotal</div>
              <div className="mt-0.5 text-xs font-bold text-slate-900">{money(subtotal)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Discount</div>
              <div className="mt-0.5 text-xs font-bold text-slate-900">{money(discountTotal)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tax (5%)</div>
              <div className="mt-0.5 text-xs font-bold text-slate-900">{money(taxTotal)}</div>
            </div>
            <div className="rounded-lg bg-blue-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Grand Total</div>
              <div className="mt-0.5 text-xs font-bold text-blue-800">{money(grandTotal)}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Amount Paid</div>
              <div className="mt-0.5 text-xs font-bold text-emerald-800">{money(amountPaid)}</div>
            </div>
            <div className="rounded-lg bg-amber-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Balance Due</div>
              <div className="mt-0.5 text-xs font-bold text-amber-800">{money(balanceDue)}</div>
              <div className="mt-0.5 text-[10px] font-semibold text-slate-600">{paymentStatus}</div>
            </div>
          </div>
        </div>

        <h2 className="mt-6 mb-2 text-sm font-bold text-slate-900">Work Details</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Work Category</th>
                <th className="px-3 py-2 text-left font-semibold">Description</th>
                <th className="px-2 py-2 text-right font-semibold">Qty / Hours</th>
                <th className="px-2 py-2 text-right font-semibold">Rate (KWD)</th>
                <th className="px-2 py-2 text-right font-semibold">Discount %</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    {loading ? "Loading work details…" : "No work items yet. Use Add work to create one."}
                  </td>
                </tr>
              ) : (
                workRecords.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {r.workCategory || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.title}</td>
                    <td className="px-2 py-2 text-right">{Number(r.quantity || 0).toFixed(3)}</td>
                    <td className="px-2 py-2 text-right">{money(Number(r.rate || 0))}</td>
                    <td className="px-2 py-2 text-right">{Number(r.discountPercent || 0)}%</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {money(Number(r.amount || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mb-2 mt-6 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Payments</h2>
          <button
            type="button"
            onClick={() => {
              setShowPaymentForm((v) => !v);
              setPaymentError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add payment
          </button>
        </div>

        {showPaymentForm && (
          <form
            onSubmit={addPayment}
            className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4"
          >
            <input
              value={payDraft.title}
              onChange={(e) => setPayDraft((p) => ({ ...p, title: e.target.value }))}
              placeholder="Payment reference"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none"
            />
            <input
              type="number"
              min="0"
              step="0.001"
              value={payDraft.amount}
              onChange={(e) => setPayDraft((p) => ({ ...p, amount: e.target.value }))}
              placeholder="Amount (KWD)"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none"
            />
            <input
              type="date"
              value={payDraft.recordDate}
              onChange={(e) => setPayDraft((p) => ({ ...p, recordDate: e.target.value }))}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none"
            />
            <div className="flex gap-2">
              <select
                value={payDraft.status}
                onChange={(e) => setPayDraft((p) => ({ ...p, status: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none"
              >
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
              </select>
              <button
                type="submit"
                disabled={savingPayment}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingPayment ? "Saving…" : "Save"}
              </button>
            </div>
            {paymentError && (
              <p className="text-xs text-red-600 sm:col-span-4">{paymentError}</p>
            )}
          </form>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {paymentRecords.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">
              {loading ? "Loading payments…" : "No payments recorded yet."}
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {paymentRecords.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">{r.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {r.recordDate || "—"} · {CLIENT_RECORD_STATUS_LABELS[r.status] ?? r.status}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-900">
                    {money(Number(r.amount || 0))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <WorkDetailsDrawer
        clientId={id}
        open={showWorkDrawer}
        onClose={() => setShowWorkDrawer(false)}
        onSaved={load}
        savedGrandTotal={grandTotal}
        amountPaid={amountPaid}
      />
    </AppShell>
  );
}
