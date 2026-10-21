"use client";
import { shortInvoiceId } from "@/lib/utils";

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
  const [reportIds, setReportIds] = useState<string[]>([]);
  const [checkingReports, setCheckingReports] = useState(false);

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
      void checkReports(invData.invoices);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client dashboard.");
    } finally {
      setLoading(false);
    }
  }

  // Which loaded invoices already have a shared report (for the count + list).
  async function checkReports(list: any[]) {
    setCheckingReports(true);
    try {
      const settled = await Promise.allSettled(
        list.map(async (inv) => {
          const res = await fetch(`/api/invoices/${inv.id}/report`);
          const data = await res.json();
          return { invId: inv.id, report: data.success && data.report ? data.report : null };
        })
      );
      const found = settled
        .filter(
          (r): r is PromiseFulfilledResult<{ invId: string; report: any }> => r.status === "fulfilled"
        )
        .map((r) => r.value);
      setReportIds(found.filter((f) => f.report).map((f) => f.invId));
      setReportCache((prev) => {
        const next = { ...prev };
        for (const f of found) {
          if (next[f.invId] === undefined) next[f.invId] = f.report;
        }
        return next;
      });
    } finally {
      setCheckingReports(false);
    }
  }

  // Outlet-wise grouping from loaded invoices (staff has no outlet API).
  const outletGroups = (() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    for (const inv of invoices) {
      const id = inv.outletId || inv.outlet?.id || "none";
      const name = inv.outlet?.name || (id === "none" ? "No outlet" : id.substring(0, 8));
      const g = byId.get(id) ?? { id, name, count: 0 };
      g.count += 1;
      byId.set(id, g);
    }
    return Array.from(byId.values()).sort((a, b) => b.count - a.count);
  })();

  async function loadMore() {    if (!nextCursor || loadingMore) return;
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
            <span className="dc-mono">{shortInvoiceId(inv)}</span>
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
      title={clientName ?? "Client"}
      subtitle="Client account overview"
      nav={[
        { href: `/staff/messages?client=${id}`, label: "Messages" },
        { href: "#reports", label: "Reports" },
      ]}
      actions={
        <Link href="/staff/dashboard" className="dc-btn">
          ← Back to dashboard
        </Link>
      }
    >
      <div className="dc-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center text-lg flex-shrink-0">
              🏪
            </span>
            <div className="min-w-0">
              <div className="text-base font-bold text-slate-900 truncate">{clientName ?? "Client"}</div>
              <div className="text-[11px] text-slate-500">Client account overview · your assigned invoices only</div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
            Active
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="dc-kpi"><span>Outlets</span><b>{outletGroups.length}</b></div>
        <div className="dc-kpi"><span>Reports</span><b>{checkingReports ? "…" : reportIds.length}</b></div>
      </div>

      <h2 className="text-sm font-bold text-slate-900">Client workspace</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {outletGroups.map((o) => (
          <div key={o.id} className="dc-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center text-sm flex-shrink-0">
                  🏪
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{o.name}</div>
                </div>
              </div>
              <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-500 text-white flex-shrink-0">
                {o.count}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[11px] text-slate-500">
              <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0">
                🧍
              </span>
              Assigned staff: You · {o.count} invoice{o.count === 1 ? "" : "s"}
            </div>
          </div>
        ))}
        {outletGroups.length === 0 && (
          <p className="text-xs text-slate-400">{loading ? "Loading outlets…" : "No outlets in your queue."}</p>
        )}
      </div>

      <h2 id="reports" className="text-sm font-bold text-slate-900 scroll-mt-4">Client reports</h2>
      <div className="space-y-2">
        {Object.entries(reportCache).filter(([, r]) => r).length === 0 ? (
          <p className="text-xs text-slate-400">{checkingReports ? "Checking…" : "No reports shared yet."}</p>
        ) : (
          Object.entries(reportCache)
            .filter(([, r]) => r)
            .map(([invId, rep]) => (
              <div key={invId} className="dc-card p-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-sm flex-shrink-0">
                  🗎
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800 truncate">{rep.fileName}</div>
                  <div className="text-[10px] text-slate-400">
                    {rep.createdAt ? new Date(rep.createdAt).toLocaleDateString() : ""}
                  </div>
                </div>
                {rep.downloadUrl && (
                  <a href={rep.downloadUrl} target="_blank" rel="noopener" className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">
                    View
                  </a>
                )}
              </div>
            ))
        )}
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

      <h2 className="text-sm font-bold text-slate-900 scroll-mt-4">Reports &amp; Documents</h2>
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
                  <span className="dc-mono">{shortInvoiceId(inv)}</span>
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
                        {rep.notes && (
                          <div className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">📝 {rep.notes}</div>
                        )}
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

      <h2 id="messages" className="text-sm font-bold text-slate-900 scroll-mt-4">Messages</h2>
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
                  <span className="dc-mono">{shortInvoiceId(inv)}</span>
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
