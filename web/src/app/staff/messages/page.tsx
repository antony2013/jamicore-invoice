"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TAB_OPTIONS = [
  { value: "inbox", label: "Inbox" },
  { value: "sent", label: "Sent" },
  { value: "drafts", label: "Drafts" },
];

type Thread = {
  invoiceId: string;
  status: string | null;
  category: string | null;
  invoiceNo: string | null;
  amount: string | null;
  createdAt: string | null;
  client: { id: string; name: string };
  lastBody: string | null;
  lastSenderType: string | null;
  lastAt: string | null;
  unread: number;
};

type Draft = {
  id: string;
  body: string;
  updatedAt: string;
  invoice: { id: string; status: string; category: string; invoiceNo: string | null } | null;
  client: { id: string; name: string } | null;
};

export default function StaffMessagesPage() {
  const [folder, setFolder] = useState("inbox");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [threadBusy, setThreadBusy] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  // Composer
  const [composing, setComposing] = useState(false);
  const [composeInvoices, setComposeInvoices] = useState<any[]>([]);
  const [composeInvoiceId, setComposeInvoiceId] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  // Draft editing
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [clientFilter, setClientFilter] = useState<string | null>(null);

  function threadQuery(): string {
    const p = new URLSearchParams();
    p.set("folder", folder === "sent" ? "sent" : "inbox");
    if (search.trim()) p.set("q", search.trim());
    p.set("limit", "50");
    if (clientFilter) p.set("client", clientFilter);
    return p.toString();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      if (folder === "drafts") {
        const res = await fetch("/api/drafts");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load drafts");
        setDrafts(data.drafts);
      } else {
        const res = await fetch(`/api/threads?${threadQuery()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load threads");
        setThreads(data.threads);
        setTotalUnread(data.totalUnread ?? 0);
      }
      setExpandedClient(null);
      setExpandedId(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(invoiceId: string) {
    if (expandedId === invoiceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(invoiceId);
    if (messages[invoiceId] !== undefined) return;
    setThreadBusy(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/messages`);
      const data = await res.json();
      setMessages((prev) => ({ ...prev, [invoiceId]: data.success ? data.messages : [] }));
    } catch {
      setMessages((prev) => ({ ...prev, [invoiceId]: [] }));
    } finally {
      setThreadBusy(null);
    }
  }

  async function sendReply(invoiceId: string, draftId?: string) {
    const body = (replies[invoiceId] || "").trim();
    if (!body) return;
    setSending(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setMessages((prev) => ({ ...prev, [invoiceId]: [...(prev[invoiceId] || []), data.message] }));
      setReplies((prev) => ({ ...prev, [invoiceId]: "" }));
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      }
      load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setSending(null);
    }
  }

  async function openComposer() {
    setComposing(true);
    if (composeInvoices.length === 0) {
      try {
        const res = await fetch("/api/invoices?assigned_to=me&limit=100");
        const data = await res.json();
        if (data.success) {
          setComposeInvoices(data.invoices);
          if (!composeInvoiceId && data.invoices.length > 0) setComposeInvoiceId(data.invoices[0].id);
        }
      } catch {
        // composer still opens; invoice list stays empty
      }
    }
  }

  async function saveComposeDraft() {
    if (!composeInvoiceId || !composeBody.trim()) return;
    setComposeBusy(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: composeInvoiceId, body: composeBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setComposeBody("");
      setComposing(false);
      setFolder("drafts");
    } catch (err: any) {
      setLoadError(err.message || "Failed to save draft.");
    } finally {
      setComposeBusy(false);
    }
  }

  async function sendCompose() {
    if (!composeInvoiceId || !composeBody.trim()) return;
    setComposeBusy(true);
    try {
      const res = await fetch(`/api/invoices/${composeInvoiceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: composeBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setComposeBody("");
      setComposing(false);
      setFolder("sent");
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setComposeBusy(false);
    }
  }

  async function deleteDraft(id: string) {
    try {
      const res = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete draft");
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setLoadError(err.message || "Failed to delete draft.");
    }
  }

  async function sendDraft(d: Draft) {
    const body = (draftEdits[d.id] ?? d.body).trim();
    if (!body || !d.invoice) return;
    try {
      const res = await fetch(`/api/invoices/${d.invoice.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
      setDraftEdits((prev) => {
        const next = { ...prev };
        delete next[d.id];
        return next;
      });
      setFolder("sent");
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    }
  }

  function continueDraft(d: Draft) {
    if (!d.invoice) return;
    setReplies((prev) => ({ ...prev, [d.invoice!.id]: d.body }));
    if (d.client) setExpandedClient(d.client.id);
    setExpandedId(d.invoice.id);
    setTimeout(() => {
      document.getElementById(`thread-${d.invoice!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(`reply-${d.invoice!.id}`)?.focus();
    }, 100);
  }

  async function saveDraftEdit(d: Draft) {
    const body = (draftEdits[d.id] ?? d.body).trim();
    if (!body || !d.invoice || body === d.body) return;
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: d.invoice.id, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...x, body, updatedAt: data.draft.updatedAt } : x)));
      setDraftEdits((prev) => {
        const next = { ...prev };
        delete next[d.id];
        return next;
      });
    } catch (err: any) {
      setLoadError(err.message || "Failed to save draft.");
    }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("client");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setClientFilter(id);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  useEffect(() => {
    if (clientFilter) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) load();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Client-wise grouping for inbox/sent (one card per client).
  const clientGroups = (() => {
    const byId = new Map<string, { id: string; name: string; threads: Thread[]; unread: number }>();
    for (const t of threads) {
      const id = t.client.id || "unknown";
      const name = t.client.name || "Unknown client";
      const g = byId.get(id) ?? { id, name, threads: [] as Thread[], unread: 0 };
      g.threads.push(t);
      g.unread += t.unread;
      byId.set(id, g);
    }
    return Array.from(byId.values()).sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name));
  })();

  const filteredDrafts = drafts.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${d.client?.name || ""} ${d.invoice?.invoiceNo || ""} ${d.body}`.toLowerCase().includes(q);
  });

  return (
    <AppShell
      role="staff"
      title="Messages"
      subtitle="Invoice Desk · Staff Mailbox"
      actions={
        totalUnread > 0 ? (
          <Badge className="bg-blue-600 text-white">{totalUnread} unread</Badge>
        ) : undefined
      }
    >
      <button
        onClick={openComposer}
        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition"
      >
        ✎ Compose Email
      </button>

      {composing && (
        <Card className="p-4">
          <div className="text-xs font-bold text-slate-800 mb-2">New message</div>
          <select
            value={composeInvoiceId}
            onChange={(e) => setComposeInvoiceId(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white outline-none mb-2"
          >
            <option value="">Choose invoice…</option>
            {composeInvoices.map((i: any) => (
              <option key={i.id} value={i.id}>
                {shortInvoiceId(i)} · {i.client?.name || ""} · {i.status}
              </option>
            ))}
          </select>
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your message…"
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={saveComposeDraft}
              disabled={composeBusy || !composeInvoiceId || !composeBody.trim()}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {composeBusy ? "Saving…" : "Save draft"}
            </button>
            <button
              onClick={sendCompose}
              disabled={composeBusy || !composeInvoiceId || !composeBody.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {composeBusy ? "Sending…" : "Send"}
            </button>
            <button onClick={() => setComposing(false)} className="text-xs text-slate-500 underline">
              Cancel
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        {TAB_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setFolder(o.value)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition border ${
              folder === o.value
                ? "bg-blue-50 border-blue-600 text-blue-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
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

      {folder === "drafts" ? (
        <div className="space-y-2">
          {filteredDrafts.length === 0 && !loading && (
            <p className="text-sm text-slate-400 text-center py-8">No drafts.</p>
          )}
          {filteredDrafts.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs min-w-0">
                  <div className="font-bold text-slate-900">{d.client?.name || "Unknown client"}</div>
                  <div className="text-slate-500">
                    <span className="dc-mono">{d.invoice ? shortInvoiceId(d.invoice) : ""}</span>
                    {d.invoice ? ` · ${d.invoice.status}` : ""}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {d.updatedAt ? new Date(d.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
              <textarea
                value={draftEdits[d.id] ?? d.body}
                onChange={(e) => setDraftEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                onBlur={() => saveDraftEdit(d)}
                rows={2}
                maxLength={2000}
                className="w-full mt-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => sendDraft(d)}
                  disabled={!d.invoice}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  Send
                </button>
                <button
                  onClick={() => continueDraft(d)}
                  disabled={!d.invoice}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  Continue in thread
                </button>
                <button
                  onClick={() => deleteDraft(d.id)}
                  className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium"
                >
                  Discard
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {clientGroups.length === 0 && !loading && (
            <p className="text-sm text-slate-400 text-center py-8">No threads found.</p>
          )}
          {loading && clientGroups.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">Loading threads…</p>
          )}
          {clientGroups.map((g) => (
            <Card key={g.id} className="p-4">
              <button
                onClick={() => setExpandedClient(expandedClient === g.id ? null : g.id)}
                className="w-full flex items-center gap-3 text-left"
              >
                <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {g.name}
                      {g.unread > 0 && (
                        <Badge className="ml-1.5 bg-blue-600 text-white">New</Badge>
                      )}
                    </span>
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {g.threads.length} thread{g.threads.length === 1 ? "" : "s"}
                    {g.unread > 0 ? ` · ${g.unread} unread` : ""}
                  </span>
                </span>
                <span className="text-slate-400">{expandedClient === g.id ? "▾" : "▸"}</span>
              </button>
              {expandedClient === g.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  {g.threads.map((t) => {
                    const thread = messages[t.invoiceId] || [];
                    return (
                      <div key={t.invoiceId} id={`thread-${t.invoiceId}`} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                        <button
                          onClick={() => toggleExpand(t.invoiceId)}
                          className="w-full flex items-center justify-between gap-2 text-left"
                        >
                          <div className="text-xs min-w-0">
                            <span className="dc-mono">{t.invoiceNo || shortInvoiceId({ id: t.invoiceId })}</span>
                            <span className="text-slate-500"> · {t.status}</span>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {t.lastBody
                                ? t.lastBody.length > 90
                                  ? `${t.lastBody.substring(0, 90)}…`
                                  : t.lastBody
                                : "Tap to open thread"}
                            </div>
                          </div>
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            {t.unread > 0 && (
                              <Badge className="bg-blue-600 text-white">{t.unread}</Badge>
                            )}
                            <span className="text-slate-400">{expandedId === t.invoiceId ? "▾" : "▸"}</span>
                          </span>
                        </button>
                        {expandedId === t.invoiceId && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            {threadBusy === t.invoiceId ? (
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
                                    <div className={`text-[10px] mt-1 ${m.senderType === "staff" ? "text-blue-100" : "text-slate-400"}`}>
                                      {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                id={`reply-${t.invoiceId}`}
                                value={replies[t.invoiceId] || ""}
                                onChange={(e) => setReplies((prev) => ({ ...prev, [t.invoiceId]: e.target.value }))}
                                placeholder="Reply to client…"
                                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                              />
                              <button
                                onClick={() => sendReply(t.invoiceId)}
                                disabled={sending === t.invoiceId || !(replies[t.invoiceId] || "").trim()}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                              >
                                {sending === t.invoiceId ? "Sending…" : "Send"}
                              </button>
                            </div>
                            <Link href={`/staff/invoices/${t.invoiceId}`} className="text-xs text-blue-600 hover:underline mt-2 inline-block">
                              Open invoice →
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
