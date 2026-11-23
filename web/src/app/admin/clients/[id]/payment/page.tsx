"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BellRing, Plus, Send } from "lucide-react";
import AppShell from "@/components/AppShell";
import WorkDetailsDrawer from "@/components/WorkDetailsDrawer";
import { CLIENT_RECORD_STATUS_LABELS } from "@/lib/client-records";
import { computeDueDate } from "@/lib/payment-due";

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
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [notificationKind, setNotificationKind] = useState("payment_update");
  const [notificationBody, setNotificationBody] = useState("");
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const [reminder, setReminder] = useState<{
    enabled: boolean;
    daysBefore: number;
    lastSentKey: string | null;
  } | null>(null);
  const [reminderDays, setReminderDays] = useState(3);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientsRes, recordsRes, reminderRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/client-records?clientId=${encodeURIComponent(id)}`),
        fetch(`/api/client-reminders?clientId=${encodeURIComponent(id)}`),
      ]);
      const clientsData = await clientsRes.json();
      const recordsData = await recordsRes.json();
      const reminderData = await reminderRes.json().catch(() => ({}));
      if (!clientsRes.ok || !recordsRes.ok) {
        throw new Error(clientsData.error || recordsData.error || "Failed to load payment details");
      }
      setClient((clientsData.clients ?? []).find((c: any) => c.id === id) ?? null);
      setRecords(recordsData.records ?? []);
      const loadedReminder = reminderData?.reminder ?? null;
      setReminder(loadedReminder);
      setReminderEnabled(Boolean(loadedReminder?.enabled));
      setReminderDays(Number(loadedReminder?.daysBefore) || 3);
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

  const notificationLabels: Record<string, string> = {
    payment_update: "Payment update",
    payment_reminder: "Payment reminder",
    payment_received: "Payment received",
  };
  const notificationRecords = records.filter((r) => r.type === "notification");
  const latestWork = workRecords[0];
  const dueDate = client
    ? computeDueDate(latestWork?.recordDate, latestWork?.createdAt, client.paymentTerms)
    : null;
  const reminderDate = dueDate && reminder
    ? new Date(dueDate.getTime() - reminder.daysBefore * 86_400_000)
    : null;

  const autoRunDone = useRef(false);
  useEffect(() => {
    if (!reminder || !reminder.enabled || autoRunDone.current) return;
    autoRunDone.current = true;
    fetch(`/api/cron/payment-reminders?client=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.sent?.length) load();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminder]);

  async function saveReminder(e: React.FormEvent) {
    e.preventDefault();
    setSavingReminder(true);
    setReminderError(null);
    try {
      const res = await fetch("/api/client-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id, enabled: reminderEnabled, daysBefore: reminderDays }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save reminder settings.");
      await load();
    } catch (err: any) {
      setReminderError(err.message || "Could not save reminder settings.");
    } finally {
      setSavingReminder(false);
    }
  }

  function openNotificationForm(kind: string) {
    const summary = `Grand Total ${money(grandTotal)} · Amount Paid ${money(amountPaid)} · Balance Due ${money(balanceDue)}.`;
    const draft =
      kind === "payment_reminder"
        ? `Payment reminder: your balance due is ${money(balanceDue)}. ${summary}`
        : kind === "payment_received"
          ? `Payment received: ${money(amountPaid)}. Thank you. ${summary}`
          : `Payment update. ${summary}`;
    setNotificationKind(kind);
    setNotificationBody(draft.slice(0, 500));
    setNotificationError(null);
    setNotificationSent(false);
    setShowNotificationForm(true);
  }

  async function sendNotification(e: React.FormEvent) {
    e.preventDefault();
    const body = notificationBody.trim();
    if (!body) return;
    setSendingNotification(true);
    setNotificationError(null);
    try {
      // The client receives a normal message (visible in their Messages), and
      // the office keeps a notification row in this client's records.
      const messageRes = await fetch("/api/client-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds: [id], body: body.slice(0, 500) }),
      });
      const messageData = await messageRes.json().catch(() => ({}));
      if (!messageRes.ok) throw new Error(messageData.error || "Could not notify client.");

      const recordRes = await fetch("/api/client-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: id,
          type: "notification",
          title: `${notificationLabels[notificationKind] ?? "Payment notification"} sent`,
          amount: Number(balanceDue.toFixed(3)),
          status: "completed",
          description: body.slice(0, 2000),
        }),
      });
      if (!recordRes.ok) {
        const d = await recordRes.json().catch(() => ({}));
        throw new Error(d.error || "Notification sent, but the record could not be saved.");
      }
      setShowNotificationForm(false);
      setNotificationSent(true);
      await load();
    } catch (err: any) {
      setNotificationError(err.message || "Could not notify client.");
    } finally {
      setSendingNotification(false);
    }
  }

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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => openNotificationForm("payment_update")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <BellRing className="h-3.5 w-3.5" /> Send notification
              </button>
              <button
                type="button"
                onClick={() => setShowWorkDrawer(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add work
              </button>
            </div>
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

        {notificationSent && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
            Payment notification sent to {client?.name ?? "the client"}.
          </div>
        )}

        {showNotificationForm && (
          <form
            onSubmit={sendNotification}
            className="mt-3 space-y-2 rounded-xl border border-blue-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-800">Send payment notification to {client?.name ?? "client"}</span>
              <select
                value={notificationKind}
                onChange={(e) => openNotificationForm(e.target.value)}
                className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none"
              >
                <option value="payment_update">Payment update</option>
                <option value="payment_reminder">Payment reminder</option>
                <option value="payment_received">Payment received</option>
              </select>
            </div>
            <textarea
              value={notificationBody}
              onChange={(e) => setNotificationBody(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            {notificationError && <p className="text-xs text-red-600">{notificationError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={sendingNotification || !notificationBody.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {sendingNotification ? "Sending…" : "Send to client"}
              </button>
              <button
                type="button"
                onClick={() => setShowNotificationForm(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <span className="ml-auto text-[11px] text-slate-400">{notificationBody.length}/500</span>
            </div>
          </form>
        )}

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Auto payment reminder</h2>
              <p className="text-[11px] text-slate-500">
                Remind this client a chosen number of days before the due date.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              Enabled
            </label>
          </div>
          <form onSubmit={saveReminder} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                Days before due date
              </label>
              <select
                value={reminderDays}
                onChange={(e) => setReminderDays(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none"
              >
                {[1, 2, 3, 5, 7, 10, 15, 30].map((d) => (
                  <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={savingReminder}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {savingReminder ? "Saving…" : "Save reminder"}
            </button>
            <div className="ml-auto text-[11px] text-slate-500">
              {dueDate ? `Due ${dueDate.toISOString().slice(0, 10)}` : "Due date unavailable"}
              {reminderDate ? ` · Reminder ${reminderDate.toISOString().slice(0, 10)}` : ""}
              {reminder?.lastSentKey ? ` · Last sent ${reminder.lastSentKey}` : ""}
            </div>
          </form>
          {reminderError && <p className="mt-2 text-xs text-red-600">{reminderError}</p>}
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

        <h2 className="mb-2 mt-6 text-sm font-bold text-slate-900">Payment notifications</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {notificationRecords.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">
              {loading ? "Loading notifications…" : "No notifications sent yet."}
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {notificationRecords.map((r) => (
                <div key={r.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">{r.title}</span>
                    <span className="text-[11px] text-slate-400">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                    </span>
                  </div>
                  {r.description && (
                    <p className="mt-0.5 whitespace-pre-line text-[11px] text-slate-500">
                      {r.description}
                    </p>
                  )}
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
