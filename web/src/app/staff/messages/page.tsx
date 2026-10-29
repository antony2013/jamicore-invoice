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
  const [replyFiles, setReplyFiles] = useState<Record<string, File | null>>({});
  const [composeFile, setComposeFile] = useState<File | null>(null);

  const REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const MAX_REPORT_BYTES = 10 * 1024 * 1024;

  // Attachments in a thread are office reports: upload the .xlsx through the
  // report pipeline (presign → PUT → confirm) so the client sees it in
  // Reports, then post a message that points at it.
  async function uploadReportAttachment(invoiceId: string, file: File, note: string) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Only .xlsx reports can be attached.");
    }
    if (file.size > MAX_REPORT_BYTES) {
      throw new Error("Report must be under 10 MB.");
    }
    const startRes = await fetch(`/api/invoices/${invoiceId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upload-url", contentLength: file.size }),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || "Could not start report upload");

    const putRes = await fetch(startData.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": REPORT_MIME },
      body: file,
    });
    if (!putRes.ok) throw new Error("Report upload failed. Try again.");

    const confirmRes = await fetch(`/api/invoices/${invoiceId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm",
        s3Key: startData.s3Key,
        fileName: file.name,
        notes: note || undefined,
      }),
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(confirmData.error || "Could not save report");
    return confirmData.report as { fileName: string };
  }

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
        setDrafts(
          clientFilter
            ? data.drafts.filter((d: Draft) => d.client?.id === clientFilter)
            : data.drafts
        );
      } else {
        const res = await fetch(`/api/threads?${threadQuery()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load threads");
        // Inbox is strictly "client wrote last / unread client mail" — same
        // rule inside a client mailbox as in the global one. Do NOT fall back
        // to folder=all here: that made our own sent mail reappear in Inbox.
        setThreads(data.threads);
        setTotalUnread(data.totalUnread ?? 0);
      }
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
      if (data.success) {
        const readCount = threads.find((t) => t.invoiceId === invoiceId)?.unread ?? 0;
        if (readCount > 0) {
          setThreads((prev) =>
            prev.map((t) => (t.invoiceId === invoiceId ? { ...t, unread: 0 } : t))
          );
          setTotalUnread((prev) => Math.max(0, prev - readCount));
        }
      }
    } catch {
      setMessages((prev) => ({ ...prev, [invoiceId]: [] }));
    } finally {
      setThreadBusy(null);
    }
  }

  async function sendReply(invoiceId: string, draftId?: string) {
    const note = (replies[invoiceId] || "").trim();
    const file = replyFiles[invoiceId] || null;
    if (!note && !file) return;
    setSending(invoiceId);
    try {
      let body = note;
      if (file) {
        const report = await uploadReportAttachment(invoiceId, file, note);
        body = `${note ? `${note}\n\n` : ""}📎 Report sent: ${report.fileName}`.slice(0, 500);
      }
      const res = await fetch(`/api/invoices/${invoiceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setMessages((prev) => ({ ...prev, [invoiceId]: [...(prev[invoiceId] || []), data.message] }));
      setReplies((prev) => ({ ...prev, [invoiceId]: "" }));
      setReplyFiles((prev) => ({ ...prev, [invoiceId]: null }));
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      }
      // The thread now awaits the client's reply, so it leaves Inbox.
      setFolder("sent");
      load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setSending(null);
    }
  }

  async function openComposer() {
    setComposing(true);
    // Inside a client mailbox the composer should never make you hunt for the
    // client: list only that client's invoices and preselect the most recent.
    if (clientFilter) {
      try {
        const res = await fetch(`/api/invoices?client=${clientFilter}&limit=100`);
        const data = await res.json();
        if (data.success) {
          setComposeInvoices(data.invoices);
          setComposeInvoiceId(data.invoices[0]?.id ?? "");
        }
      } catch {
        // composer still opens; invoice list stays empty
      }
      return;
    }
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
    const note = composeBody.trim();
    if (!composeInvoiceId || (!note && !composeFile)) return;
    setComposeBusy(true);
    try {
      let body = note;
      if (composeFile) {
        const report = await uploadReportAttachment(composeInvoiceId, composeFile, note);
        body = `${note ? `${note}\n\n` : ""}📎 Report sent: ${report.fileName}`.slice(0, 500);
      }
      const res = await fetch(`/api/invoices/${composeInvoiceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setComposeBody("");
      setComposeFile(null);
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

  function splitMessage(body?: string | null) {
    const text = (body || "").trim();
    if (!text) return { subject: "New message", preview: "" };
    const newline = text.indexOf("\n");
    if (newline > 0) {
      return {
        subject: text.slice(0, newline),
        preview: text.slice(newline + 1).replace(/\n+/g, " "),
      };
    }
    const match = text.match(/^(.{8,90}?[.!?])\s+(.+)$/s);
    if (match) return { subject: match[1], preview: match[2] };
    return { subject: text, preview: "" };
  }

  function formatWhen(value?: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today, ${time}`;
    return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}, ${time}`;
  }

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
      nav={[
        {
          href: clientFilter ? `/staff/messages?client=${clientFilter}` : "/staff/messages",
          label: "Messages",
        },
        {
          href: clientFilter ? `/staff/reports?client=${clientFilter}` : "/staff/reports",
          label: "Reports",
        },
        {
          href: clientFilter
            ? `/staff/reports/trash?client=${clientFilter}`
            : "/staff/reports/trash",
          label: "Trash",
        },
      ]}
      actions={
        <div className="flex items-center gap-3">
          {clientFilter ? (
            <Link href={`/staff/clients/${clientFilter}`} className="dc-btn">
              ← Back to client
            </Link>
          ) : null}
          {totalUnread > 0 ? (
            <Badge className="bg-blue-600 text-white">{totalUnread} unread</Badge>
          ) : null}
        </div>
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
          {!clientFilter && (
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
          )}
          {clientFilter && (
            <div className="text-[11px] text-slate-500 mb-2">
              To: {composeInvoices[0]?.client?.name || "this client"}
              {composeInvoices.length === 0 ? " · no open invoice — message needs an invoice" : ""}
            </div>
          )}
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your message…"
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <label className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50">
              📎 Attach report
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  setComposeFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </label>
            {composeFile && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-[11px] text-slate-700">
                {composeFile.name}
                <button onClick={() => setComposeFile(null)} className="text-slate-500 hover:text-slate-800" aria-label="Remove attachment">
                  ×
                </button>
              </span>
            )}
          </div>
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
              disabled={composeBusy || !composeInvoiceId || (!composeBody.trim() && !composeFile)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {composeBusy ? "Sending…" : composeFile ? "Send report" : "Send"}
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
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-slate-900">
              {folder === "sent" ? "Sent" : "Inbox"}
            </h2>
            <span className="text-[12px] text-slate-500">
              {threads.length} email{threads.length === 1 ? "" : "s"}
            </span>
          </div>
          {threads.length === 0 && !loading && (
            <p className="text-sm text-slate-400 text-center py-8">No threads found.</p>
          )}
          {loading && threads.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">Loading threads…</p>
          )}
          {threads.map((t) => {
            const thread = messages[t.invoiceId] || [];
            const { subject, preview } = splitMessage(t.lastBody);
            const unread = t.unread > 0;
            return (
              <Card
                key={t.invoiceId}
                id={`thread-${t.invoiceId}`}
                className={`overflow-hidden ${unread ? "bg-[#F5F9FF]" : "bg-white"}`}
              >
                <button
                  onClick={() => toggleExpand(t.invoiceId)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-slate-700 truncate">
                        {t.client.name || "Unknown client"}
                      </span>
                      {unread && <Badge className="bg-blue-600 text-white">New</Badge>}
                    </span>
                    <span className="block text-[13px] font-bold text-slate-900 truncate">
                      {subject}
                    </span>
                    {preview ? (
                      <span className="block text-[11px] text-slate-500 truncate">
                        {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-200 bg-white text-[10px] font-semibold text-blue-600">
                        {t.invoiceNo || shortInvoiceId({ id: t.invoiceId })}
                      </span>
                      <span className="text-[10px] text-slate-400">{formatWhen(t.lastAt)}</span>
                    </span>
                  </span>
                  <span className="text-slate-400 text-xs mt-1">
                    {expandedId === t.invoiceId ? "▾" : "▸"}
                  </span>
                </button>
                {expandedId === t.invoiceId && (
                  <div className="px-4 pb-4">
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
                            {replyFiles[t.invoiceId] && (
                              <div className="mb-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-[11px] text-slate-700">
                                📎 {replyFiles[t.invoiceId]!.name}
                                <button
                                  onClick={() => setReplyFiles((prev) => ({ ...prev, [t.invoiceId]: null }))}
                                  className="text-slate-500 hover:text-slate-800"
                                  aria-label="Remove attachment"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <label
                                className="inline-flex items-center justify-center w-9 h-9 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 flex-shrink-0"
                                title="Attach report (.xlsx)"
                              >
                                📎
                                <input
                                  type="file"
                                  accept=".xlsx"
                                  className="hidden"
                                  onChange={(e) => {
                                    const picked = e.target.files?.[0] ?? null;
                                    setReplyFiles((prev) => ({ ...prev, [t.invoiceId]: picked }));
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                              <input
                                id={`reply-${t.invoiceId}`}
                                value={replies[t.invoiceId] || ""}
                                onChange={(e) => setReplies((prev) => ({ ...prev, [t.invoiceId]: e.target.value }))}
                                placeholder={replyFiles[t.invoiceId] ? "Add a note with the report…" : "Reply to client…"}
                                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                              />
                              <button
                                onClick={() => sendReply(t.invoiceId)}
                                disabled={
                                  sending === t.invoiceId ||
                                  (!(replies[t.invoiceId] || "").trim() && !replyFiles[t.invoiceId])
                                }
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                              >
                                {sending === t.invoiceId
                                  ? "Sending…"
                                  : replyFiles[t.invoiceId]
                                    ? "Send report"
                                    : "Send"}
                              </button>
                            </div>
                            <Link href={`/staff/invoices/${t.invoiceId}`} className="text-xs text-blue-600 hover:underline mt-2 inline-block">
                              Open invoice →
                            </Link>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
