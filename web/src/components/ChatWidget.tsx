"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X, Paperclip, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ChatMsg = {
  id: string;
  senderType: string; // "staff" | "client"
  body: string | null;
  attachmentS3Key: string | null;
  attachmentName: string | null;
  createdAt: string;
};

export default function ChatWidget({
  clientId,
  scopeId, // outlet uuid or "none"
  outletLabel,
  invoices, // invoices in this outlet, for per-invoice scoping
  requestScope, // { id: invoice uuid, seq } — set from an invoice card's Chat button
  initialScopeType = "outlet", // page can start the chat scoped to an invoice directly
}: {
  clientId: string;
  scopeId: string;
  outletLabel: string;
  invoices: Array<{ id: string; label: string }>;
  requestScope?: { id: string; seq: number };
  initialScopeType?: "outlet" | "invoice";
}) {
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<"outlet" | "invoice">(initialScopeType);
  const [activeId, setActiveId] = useState(
    initialScopeType === "invoice" ? requestScope?.id ?? scopeId : scopeId
  );
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // API scope id: "clientId:outletUuid" (or "clientId:none") whole outlet; plain invoice uuid otherwise.
  const activeScopeApiId = scopeType === "outlet" ? `${clientId}:${activeId}` : activeId;

  async function load() {
    setError(null);
    try {
      const p = new URLSearchParams({ scopeType, scopeId: activeScopeApiId });
      const res = await fetch(`/api/chat?${p.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load chat");
      setMessages(data.messages ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load chat.");
    }
  }

  useEffect(() => {
    if (requestScope?.seq && requestScope.id) {
      setScopeType("invoice");
      setActiveId(requestScope.id);
      setOpen(true);
    }
  }, [requestScope?.seq]);

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeType, activeScopeApiId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function send() {
    const body = input.trim();
    if ((!body && !file) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("scopeType", scopeType);
      fd.set("scopeId", activeScopeApiId);
      fd.set("message", body);
      if (file) fd.set("file", file);
      const res = await fetch("/api/chat", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      // Server stores the message; reload the thread to show it.
      setInput("");
      setFile(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to send.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function openAttachment(m: ChatMsg) {
    if (!m.attachmentS3Key || m.attachmentS3Key === "just-sent") return;
    try {
      const res = await fetch(`/api/chat/attachment?key=${encodeURIComponent(m.attachmentS3Key)}`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener");
    } catch {
      setError("Failed to open attachment.");
    }
  }

  function startInvoiceChat(invId: string) {
    setScopeType("invoice");
    setActiveId(invId);
    setOpen(true);
  }

  const scopeLabel =
    scopeType === "outlet"
      ? `${outletLabel} · Outlet chat`
      : `${invoices.find((i) => i.id === activeId)?.label ?? "Invoice"} · Invoice chat`;

  return (
    <>
      {open ? (
        <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col" style={{ height: 480 }}>
          <div className="flex items-center justify-between gap-2 bg-slate-900 px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-bold truncate">
                {scopeLabel}
              </div>
              <div className="text-[10px] text-slate-300">Office staff · client chat</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-slate-300 hover:text-white flex-shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <button
              onClick={() => {
                setScopeType("outlet");
                setActiveId(scopeId);
              }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition ${
                scopeType === "outlet" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Whole outlet
            </button>
            <select
              value={scopeType === "invoice" ? activeId : ""}
              onChange={(e) => {
                if (!e.target.value) {
                  setScopeType("outlet");
                  setActiveId(scopeId);
                } else {
                  setScopeType("invoice");
                  setActiveId(e.target.value);
                }
              }}
              className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 outline-none"
            >
              <option value="">This outlet's invoices…</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3 bg-slate-50">
            {messages.length === 0 && !busy && (
              <p className="text-[11px] text-slate-400 text-center pt-6">
                Message the client about this {scopeType} — questions, notes, attachments.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-1.5 ${m.senderType === "staff" ? "justify-end" : "justify-start"}`}>
                {m.senderType !== "staff" && (
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0">
                    <User className="h-3 w-3" />
                  </span>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.senderType === "staff"
                      ? "bg-blue-600 text-white"
                      : "bg-white border border-slate-200 text-slate-800"
                  }`}
                >
                  {m.body}
                  {m.attachmentName && (
                    <button
                      onClick={() => openAttachment(m)}
                      className={`mt-1 flex items-center gap-1 text-[10px] font-semibold underline ${
                        m.senderType === "staff" ? "text-blue-100" : "text-blue-600"
                      }`}
                    >
                      📎 {m.attachmentName}
                    </button>
                  )}
                </div>
                {m.senderType === "staff" && (
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                    <User className="h-3 w-3" />
                  </span>
                )}
              </div>
            ))}
            {busy && (
              <p className="text-[10px] text-slate-400 text-center">Sending…</p>
            )}
            {error && <p className="text-[10px] text-red-600 text-center">{error}</p>}
          </div>

          <div className="border-t border-slate-200 bg-white px-3 py-2.5">
            {file && (
              <div className="mb-1.5 flex items-center gap-1 text-[10px] text-slate-600">
                📎 {file.name}
                <button onClick={() => setFile(null)} className="text-slate-400 hover:text-slate-700" aria-label="Remove attachment">
                  ×
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <label className="flex-shrink-0 cursor-pointer rounded-full p-1.5 hover:bg-slate-100" title="Attach image or PDF">
                <Paperclip className="h-4 w-4 text-slate-500" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={`Message client about this ${scopeType}…`}
                className="flex-1 min-w-0 resize-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-100"
              />
              <Button
                size="sm"
                onClick={send}
                disabled={busy || (!input.trim() && !file)}
                className="h-8 flex-shrink-0 rounded-lg bg-blue-600 hover:bg-blue-700 px-2.5"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-3 shadow-2xl transition"
          title="Chat with client"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-[12px] font-semibold hidden sm:inline">Chat</span>
        </button>
      )}
    </>
  );
}

/** Small inline trigger for a specific invoice card.
 * Rendered as a span because it sits inside the invoice card's <button> —
 * nested <button> elements cause a hydration error. */
export function ChatInvoiceButton({ onChat }: { onChat: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onChat();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          onChat();
        }
      }}
      className="inline-block cursor-pointer rounded-md border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:text-blue-600 transition"
      title="Message the client about this invoice"
    >
      💬 Chat
    </span>
  );
}
