"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";

export default function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<any | null>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [openThreads, setOpenThreads] = useState<number | null>(null);
  const [totalInvoices, setTotalInvoices] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, outletRes, invRes, statsRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/outlets?clientId=${encodeURIComponent(id)}`),
        fetch(`/api/invoices?client=${encodeURIComponent(id)}&limit=5`),
        fetch(`/api/invoices/stats?client=${encodeURIComponent(id)}`),
      ]);
      const clientData = await clientRes.json();
      const outletData = await outletRes.json();
      const invData = await invRes.json();
      const statsData = await statsRes.json();
      if (clientData.success) {
        const found = (clientData.clients as any[]).find((c) => c.id === id);
        if (!found) throw new Error("Client not found.");
        setClient(found);
      }
      if (!outletData.success) throw new Error(outletData.error || "Failed to load outlets");
      setOutlets(outletData.outlets);
      if (!invData.success) throw new Error(invData.error || "Failed to load invoices");
      setRecent(invData.invoices);
      if (statsData.success) {
        setTotalInvoices(statsData.stats.total);
        setOpenThreads(statsData.stats.byStatus.needs_info ?? 0);
      }
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const staffNames = Array.from(
    new Set(
      [
        client?.assignedStaffName,
        ...outlets.map((o) => o.assignedStaffName),
      ].filter(Boolean)
    )
  );

  return (
    <AppShell
      role="admin"
      title={client ? client.name : "Client"}
      subtitle="Client account overview"
      actions={
        <div className="flex items-center gap-2">
          {client && !client.archivedAt && (
            <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700">
              Active
            </span>
          )}
          {client?.archivedAt && (
            <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-slate-200 text-slate-600">
              Archived
            </span>
          )}
          <Link href="/admin/clients" className="dc-btn">
            Back to Clients
          </Link>
        </div>
      }
    >
      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}
      {loading && !client ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading client…</p>
      ) : null}
      {client ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="dc-kpi"><span>Outlets</span><b>{outlets.length}</b></div>
          <div className="dc-kpi"><span>Staff</span><b>{staffNames.length}</b></div>
          <div className="dc-kpi"><span>Invoices</span><b>{totalInvoices ?? client.totalInvoices}</b></div>
          <div className="dc-kpi"><span>Open threads</span><b>{openThreads ?? "…"}</b></div>
        </div>
      ) : null}

      <h2 className="text-sm font-bold text-slate-900">Client workspace</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a href="#outlets" className="dc-card p-4 hover:shadow-md transition">
          <div className="text-sm font-bold text-slate-900">Outlets &amp; Staff</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Shops and default staff routing</div>
        </a>
        <Link href={`/admin/clients/${id}/reports`} className="dc-card p-4 hover:shadow-md transition">
          <div className="text-sm font-bold text-slate-900">Reports</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Invoice reports by category and status</div>
        </Link>
        <Link
          href={`/admin/dashboard?client=${encodeURIComponent(id)}`}
          className="dc-card p-4 hover:shadow-md transition"
        >
          <div className="text-sm font-bold text-slate-900">Messages</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {openThreads === null ? "Conversation threads" : `${openThreads} thread(s) awaiting reply`}
          </div>
        </Link>
        <a href="#account" className="dc-card p-4 hover:shadow-md transition">
          <div className="text-sm font-bold text-slate-900">Account details</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Login, contact, and archive state</div>
        </a>
      </div>

      <div id="outlets" className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">Assigned outlets</h2>
        <Link href="/admin/clients" className="dc-btn">Manage outlets</Link>
      </div>
      <div className="space-y-2">
        {outlets.length === 0 && (
          <p className="text-xs text-slate-400">{loading ? "Loading outlets…" : "No outlets yet."}</p>
        )}
        {outlets.map((o) => (
          <div key={o.id} className="dc-card p-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-800">{o.name}</div>
              <div className="text-[11px] text-slate-500">
                {[o.address, o.phone].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-600">
              {o.assignedStaffName || "Manual routing"}
            </span>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-bold text-slate-900">Recent invoices</h2>
      <div className="space-y-2">
        {recent.length === 0 && (
          <p className="text-xs text-slate-400">{loading ? "Loading invoices…" : "No invoices yet."}</p>
        )}
        {recent.map((inv) => (
          <Link
            key={inv.id}
            href={`/admin/invoices/${inv.id}`}
            className="dc-card p-3 flex items-center justify-between gap-2 hover:shadow-md transition"
          >
            <div className="text-xs text-slate-600">
              <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
              {inv.createdAt
                ? <span> · {`${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>
                : null}
              <span> · {({ sales_invoice: "Sales Invoice", purchase_bill: "Purchase Bill", expense_bill: "Expenses Bill", asset_bill: "Assets", other: "Others" } as Record<string, string>)[inv.category] || inv.category || "—"}</span>
              <span className="text-slate-400"> · {inv.status}</span>
            </div>
            <div className="text-xs font-bold text-slate-900">J${inv.ocrData?.amount || "0.00"}</div>
          </Link>
        ))}
      </div>

      <div id="account" className="dc-card p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-2">Account details</h2>
        {client ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div><span className="text-slate-400">User ID: </span><span className="font-mono">{client.username || "—"}</span></div>
          <div><span className="text-slate-400">Phone: </span><span className="font-mono">{client.phone || "—"}</span></div>
          <div><span className="text-slate-400">Email: </span>{client.email || "—"}</div>
          <div><span className="text-slate-400">Joined: </span>{client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}</div>
          <div><span className="text-slate-400">Default staff: </span>{client.assignedStaffName || "Manual"}</div>
          <div><span className="text-slate-400">Login: </span>{client.archivedAt ? "Blocked (archived)" : "Allowed"}</div>
        </div>
        ) : (
          <p className="text-xs text-slate-400">{loading ? "Loading account…" : "No client data."}</p>
        )}
      </div>
    </AppShell>
  );
}
