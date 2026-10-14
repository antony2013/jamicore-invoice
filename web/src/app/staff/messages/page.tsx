"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";

const TAB_OPTIONS = [
  { value: "all", label: "All" },
  { value: "needs_info", label: "Needs reply" },
  { value: "in_review", label: "In review" },
];

type ThreadMessage = {
  id: string;
  senderType: string;
  senderName: string | null;
  body: string;
  createdAt: string;
};

export default function StaffMessagesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadMessage[]>>({});
  const [threadBusy, setThreadBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function query(cursor?: string | null): string {
    const p = new URLSearchParams();
    p.set("assigned_to", "me");
    if (tab !== "all") p.set("status", tab);
    if (search.trim()) p.set("q", search.trim());
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/invoices?${query()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load threads");
      setInvoices(data.invoices);
      setNextCursor(data.nextCursor ?? null);
      setExpandedId(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load messages.");
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
      setLoadError(err.message || "Failed to load more threads.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleExpand(inv: any) {
    if (expandedId === inv.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(inv.id);
    if (threads[inv.id] !== undefined) return;
    setThreadBusy(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/messages`);
      const data = await res.json();
      setThreads((prev) => ({ ...prev, [inv.id]: data.success ? data.messages : [] }));
    } catch {
      setThreads((prev) => ({ ...prev, [inv.id]: [] }));
    } finally {
      setThreadBusy(null);
    }
  }

  async function sendReply(invId: string) {
    const body = (drafts[invId] || "").trim();
    if (!body) return;
    setSending(invId);
    try {
      const res = await fetch(`/api/invoices/${invId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setThreads((prev) => ({ ...prev, [invId]: [...(prev[invId] || []), data.message] }));
      setDrafts((prev) => ({ ...prev, [invId]: "" }));
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setSending(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) load();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <AppShell
      role="staff"
      title="Messages"
      subtitle="Client conversation threads on your assigned invoices."
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {TAB_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setTab(o.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tab === o.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search emails, clients, invoice IDs…"
        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
      />

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      <div className="space-y-2">
        {invoices.length === 0 && !loading && (
          <p className="text-sm text-slate-400 text-center py-8">No threads found.</p>
        )}
        {loading && invoices.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Loading threads…</p>
        )}
        {invoices.map((inv) => {
          const thread = threads[inv.id] || [];
          return (
            <Card key={inv.id} className="p-4">
              <button
                onClick={() => toggleExpand(inv)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <div className="text-xs">
                  <div className="font-bold text-slate-900">{inv.client?.name || "Unknown client"}</div>
                  <div className="text-slate-500">
                    <span className="dc-mono">{inv.ocrData?.invoiceNo || String(inv.id).substring(0, 8)}</span>
                    {inv.createdAt
                      ? ` · ${new Date(inv.createdAt).toLocaleDateString()}, ${new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""} · {inv.status}
                  </div>
                </div>
                <span className="text-slate-400">{expandedId === inv.id ? "▾" : "▸"}</span>
              </button>
              {expandedId === inv.id && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {threadBusy === inv.id ? (
                    <p className="text-xs text-slate-400">Loading thread…</p>
                  ) : thread.length === 0 ? (
                    <p className="text-xs text-slate-400">No messages yet.</p>
                  ) : (
                    <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
                      {thread.map((m) => (
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
                          <div className={`text-[10px] mt-1 ${m.senderType === "staff" ? "text-blue-100" : "text-slate-400"}`}>
                            {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={drafts[inv.id] || ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      placeholder="Reply to client…"
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                    />
                    <button
                      onClick={() => sendReply(inv.id)}
                      disabled={sending === inv.id || !(drafts[inv.id] || "").trim()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      {sending === inv.id ? "Sending…" : "Send"}
                    </button>
                  </div>
                  <Link href={`/staff/invoices/${inv.id}`} className="text-xs text-blue-600 hover:underline mt-2 inline-block">
                    Open invoice →
                  </Link>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="dc-btn">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
