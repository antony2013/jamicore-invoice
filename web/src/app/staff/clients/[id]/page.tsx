"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

const CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "sales_invoice", label: "Sales Invoice" },
  { value: "expense_bill", label: "Expenses Bill" },
  { value: "purchase_bill", label: "Purchase Bill" },
  { value: "asset_bill", label: "Assets" },
  { value: "other", label: "Others" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Need to start" },
  { value: "in_progress", label: "In progress" },
  { value: "verified", label: "Verified" },
  { value: "finished", label: "Finished" },
];

const CATEGORY_LABELS: Record<string, string> = {
  sales_invoice: "Sales Invoice",
  purchase_bill: "Purchase Bill",
  expense_bill: "Expenses Bill",
  asset_bill: "Assets",
  other: "Others",
};

function statusChip(status: string): string {
  if (status === "verified") return "bg-blue-100 text-blue-800";
  if (status === "collected" || status === "disputed") return "bg-emerald-100 text-emerald-800";
  if (status === "in_review" || status === "needs_info") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export default function StaffClientDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [clientName, setClientName] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [stats, setStats] = useState<{ byStatus: Record<string, number>; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [reportCache, setReportCache] = useState<Record<string, any>>({});
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
  const [msgThreads, setMsgThreads] = useState<Record<string, any[]>>({});
  const [msgBusy, setMsgBusy] = useState<string | null>(null);
  const [msgDrafts, setMsgDrafts] = useState<Record<string, string>>({});
  const [msgSending, setMsgSending] = useState<string | null>(null);

  // Staff scope is enforced server-side (assigned_to=me always); the
  // client filter only narrows within the staffer's own queue.
  function query(cursor?: string | null): string {
    const p = new URLSearchParams();
    p.set("assigned_to", "me");
    p.set("client", id);
    if (categoryFilter !== "all") p.set("category", categoryFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (search.trim()) p.set("q", search.trim());
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [invRes, statsRes] = await Promise.all([
        fetch(`/api/invoices?${query()}`),
        fetch(`/api/invoices/stats?${query()}`),
      ]);
      const invData = await invRes.json();
      const statsData = await statsRes.json();
      if (!invData.success) throw new Error(invData.error || "Failed to load invoices");
      setInvoices(invData.invoices);
      setNextCursor(invData.nextCursor ?? null);
      const firstClient = (invData.invoices as any[]).find((i) => i.client?.name)?.client?.name;
      if (firstClient) setClientName(firstClient);
      if (statsData.success) setStats(statsData.stats);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/invoices?${query(nextCursor)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load more");
      setInvoices((prev) => [...prev, ...data.invoices]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load more invoices.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) load();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const byStatus = stats?.byStatus ?? {};
  const inProgress = (byStatus.assigned ?? 0) + (byStatus.in_review ?? 0) + (byStatus.needs_info ?? 0);
  const finished = (byStatus.collected ?? 0) + (byStatus.disputed ?? 0);
  const sales = invoices.filter((i) => i.category === "sales_invoice");
  const bills = invoices.filter((i) => i.category !== "sales_invoice");
  const showSplit = categoryFilter === "all";

  async function toggleReport(inv: any) {
    if (expandedReportId === inv.id) {
      setExpandedReportId(null);
      return;
    }
    setExpandedReportId(inv.id);
    if (reportCache[inv.id] !== undefined) return;
    setReportBusy(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/report`);
      const data = await res.json();
      setReportCache((prev) => ({ ...prev, [inv.id]: data.success ? data.report : null }));
    } catch {
      setReportCache((prev) => ({ ...prev, [inv.id]: null }));
    } finally {
      setReportBusy(null);
    }
  }

  async function toggleMessages(inv: any) {
    if (expandedMsgId === inv.id) {
      setExpandedMsgId(null);
      return;
    }
    setExpandedMsgId(inv.id);
    if (msgThreads[inv.id] !== undefined) return;
    setMsgBusy(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/messages`);
      const data = await res.json();
      setMsgThreads((prev) => ({ ...prev, [inv.id]: data.success ? data.messages : [] }));
    } catch {
      setMsgThreads((prev) => ({ ...prev, [inv.id]: [] }));
    } finally {
      setMsgBusy(null);
    }
  }

  async function sendReply(invId: string) {
    const body = (msgDrafts[invId] || "").trim();
    if (!body) return;
    setMsgSending(invId);
    try {
      const res = await fetch(`/api/invoices/${invId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setMsgThreads((prev) => ({ ...prev, [invId]: [...(prev[invId] || []), data.message] }));
      setMsgDrafts((prev) => ({ ...prev, [invId]: "" }));
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setMsgSending(null);
    }
  }

  function card(inv: any) {
    return (
      <Link
        key={inv.id}
        href={`/staff/invoices/${inv.id}`}
        className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-xs text-slate-600">
            <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
            {inv.createdAt
              ? <span> · {`${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>
              : null}
            <span> · {CATEGORY_LABELS[inv.category] || inv.category || "—"}</span>
          </div>
          <span className={`dc-chip flex-shrink-0 ${statusChip(inv.status)}`}>{inv.status}</span>
        </div>
        <div className="text-sm font-bold text-slate-900">
          J${inv.ocrData?.amount || "0.00"}
        </div>
        {inv.outlet?.name && (
          <div className="text-[11px] text-slate-500 mt-1">{inv.outlet.name}</div>
        )}
      </Link>
    );
  }

  return (
    <AppShell
      role="staff"
      title="Reports Uploaded"
      subtitle={`Client: ${clientName ?? "…"} — your assigned invoices only`}
      actions={
        <Link href="/staff/dashboard#client-cards" className="dc-btn">
          Back to Clients
        </Link>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="dc-kpi"><span>Total uploaded</span><b>{stats ? stats.total : "…"}</b></div>
        <div className="dc-kpi"><span>In progress</span><b>{stats ? inProgress : "…"}</b></div>
        <div className="dc-kpi"><span>Verified</span><b>{stats ? byStatus.verified ?? 0 : "…"}</b></div>
        <div className="dc-kpi"><span>Finished</span><b>{stats ? finished : "…"}</b></div>
      </div>

      <Card className="p-4">
        <div className="text-xs font-bold text-slate-800 mb-2">Sections</div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {CATEGORY_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setCategoryFilter(o.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                categoryFilter === o.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusFilter === o.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice ID or document type…"
          className="mt-3 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
        />
      </Card>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      {showSplit ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Invoices · {sales.length}</h2>
            <div className="space-y-3">{sales.map(card)}</div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Bills · {bills.length}</h2>
            <div className="space-y-3">{bills.map(card)}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">{invoices.map(card)}</div>
      )}

      {invoices.length === 0 && !loading && (
        <p className="text-sm text-slate-400 text-center py-8">No invoices match these filters.</p>
      )}
      {loading && invoices.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">Loading invoices…</p>
      )}
      {nextCursor && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="dc-btn">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <h2 className="text-sm font-bold text-slate-900">Reports &amp; Documents</h2>
      <p className="text-[11px] text-slate-500">Upload, organize and view this client&apos;s reports.</p>
      {invoices.length > 0 ? (
        <Link
          href={`/staff/invoices/${invoices[0].id}`}
          className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition"
        >
          ⬆ Upload Report
        </Link>
      ) : (
        <button disabled className="w-full py-3 px-4 bg-slate-200 text-slate-400 rounded-xl text-sm font-semibold">
          ⬆ Upload Report
        </button>
      )}
      <p className="text-[11px] text-slate-400">
        Reports attach to invoices — uploading opens an invoice where you generate or attach its Excel report.
      </p>

      <h3 className="text-xs font-bold text-slate-800">Client report library</h3>      <div className="space-y-2">
        {invoices.length === 0 && !loading && (
          <p className="text-xs text-slate-400">No invoices, so no reports yet.</p>
        )}
        {invoices.map((inv) => {
          const rep = reportCache[inv.id];
          return (
            <Card key={`rep-${inv.id}`} className="p-4">
              <button
                onClick={() => toggleReport(inv)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <div className="text-xs">
                  <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
                  <span className="text-slate-500"> · {inv.status}</span>
                </div>
                <span className="text-slate-400">{expandedReportId === inv.id ? "▾" : "▸"}</span>
              </button>
              {expandedReportId === inv.id && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {reportBusy === inv.id ? (
                    <p className="text-xs text-slate-400">Loading report…</p>
                  ) : rep ? (
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-lg flex-shrink-0">
                        🗎
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900 truncate">{rep.fileName}</div>
                        <div className="text-[11px] text-slate-500">
                          {clientName || "Client"} · {rep.createdAt ? new Date(rep.createdAt).toLocaleDateString() : ""}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {rep.downloadUrl && (
                            <>
                              <a href={rep.downloadUrl} target="_blank" rel="noopener" className="dc-btn">
                                👁 View
                              </a>
                              <a href={rep.downloadUrl} download={rep.fileName} className="dc-btn">
                                ⬇ Download
                              </a>
                            </>
                          )}
                          <Link href={`/staff/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline">
                            Open invoice →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No report shared yet.</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <h2 className="text-sm font-bold text-slate-900">Messages</h2>
      <p className="text-[11px] text-slate-500">Client conversation threads for this client only.</p>
      <div className="space-y-2">
        {invoices.length === 0 && !loading && (
          <p className="text-xs text-slate-400">No threads yet.</p>
        )}
        {invoices.map((inv) => {
          const thread = msgThreads[inv.id] || [];
          return (
            <Card key={`msg-${inv.id}`} className="p-4">
              <button
                onClick={() => toggleMessages(inv)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <div className="text-xs">
                  <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
                  <span className="text-slate-500"> · {inv.status}</span>
                </div>
                <span className="text-slate-400">{expandedMsgId === inv.id ? "▾" : "▸"}</span>
              </button>
              {expandedMsgId === inv.id && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {msgBusy === inv.id ? (
                    <p className="text-xs text-slate-400">Loading thread…</p>
                  ) : thread.length === 0 ? (
                    <p className="text-xs text-slate-400">No messages yet.</p>
                  ) : (
                    <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
                      {thread.map((m: any) => (
                        <div
                          key={m.id}
                          className={`p-2.5 rounded-lg text-xs max-w-[90%] ${
                            m.senderType === "staff"
                              ? "ml-auto bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-800"
                          }`}
                        >
                          <div className={`font-bold mb-0.5 ${m.senderType === "staff" ? "text-blue-100" : "text-slate-500"}`}>
                            {m.senderName || (m.senderType === "staff" ? "Staff" : "Client")}
                          </div>
                          <div>{m.body}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={msgDrafts[inv.id] || ""}
                      onChange={(e) => setMsgDrafts((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      placeholder="Reply to client…"
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                    />
                    <button
                      onClick={() => sendReply(inv.id)}
                      disabled={msgSending === inv.id || !(msgDrafts[inv.id] || "").trim()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      {msgSending === inv.id ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
