"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Paperclip,
  PenLine,
  Search,
  User,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TAB_OPTIONS = [
  { value: "inbox", label: "Inbox" },
  { value: "sent", label: "Sent" },
  { value: "drafts", label: "Drafts" },
];

const UNASSIGNED = "__unassigned__";

type Thread = {
  invoiceId: string;
  jobNumber: string | null;
  status: string | null;
  category: string | null;
  invoiceNo: string | null;
  amount: string | null;
  createdAt: string | null;
  client: { id: string; name: string };
  assignedStaff: { id: string; name: string } | null;
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

type InvoiceOption = {
  id: string;
  jobNumber: string | null;
  createdAt: string;
  client?: { id: string; name: string } | null;
  assignedStaff?: { id: string; name: string } | null;
};

type Option = { value: string; label: string };

type StaffDirectMessage = {
  id: string;
  body: string;
  isRead?: boolean;
  createdAt: string;
  sender?: { id: string; name: string };
  recipient?: { id: string; name: string };
};

type RecipientRow =
  | { kind: "client"; id: string; name: string; detail: string | null; deliverable: boolean }
  | { kind: "staff"; id: string; name: string };

/** Excel-style recipient picker: search, select all, tick list, done. */
function CheckFilter({
  label,
  options,
  selected,
  onChange,
  open,
  onToggle,
  onClose,
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  const allSelected = options.length > 0 && options.every((o) => selected.has(o.value));

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {selected.size > 0 ? `${label} · ${selected.size}` : label}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
                className="w-full border-0 bg-transparent py-1.5 text-xs outline-none"
                aria-label={`Search ${label}`}
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => onChange(allSelected ? new Set() : new Set(options.map((o) => o.value)))}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                  allSelected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                }`}
              >
                {allSelected ? <Check className="h-3 w-3" /> : null}
              </span>
              (Select all)
            </button>
            {shown.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                      on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                    }`}
                  >
                    {on ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
            {shown.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-slate-400">No matches.</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-2 py-2">
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminMessagesPage() {
  const [folder, setFolder] = useState("inbox");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [staffInbox, setStaffInbox] = useState<StaffDirectMessage[]>([]);
  const [staffSent, setStaffSent] = useState<StaffDirectMessage[]>([]);
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [threadBusy, setThreadBusy] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

  // Composer: one common message to many clients.
  const [composing, setComposing] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);
  const [invoiceOptions, setInvoiceOptions] = useState<InvoiceOption[]>([]);
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeClientSel, setComposeClientSel] = useState<Set<string>>(new Set());
  const [composeStaffSel, setComposeStaffSel] = useState<Set<string>>(new Set());
  const [composeOpenFilter, setComposeOpenFilter] = useState<"client" | "staff" | null>(null);
  const composeFilterRef = useRef<HTMLDivElement | null>(null);

  // Draft editing
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [replyFiles, setReplyFiles] = useState<Record<string, File | null>>({});

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
        const [threadRes, staffRes] = await Promise.all([
          fetch(`/api/threads?${threadQuery()}`),
          fetch("/api/staff-messages"),
        ]);
        const data = await threadRes.json();
        if (!threadRes.ok) throw new Error(data.error || "Failed to load threads");
        setThreads(data.threads);

        const staffData = await staffRes.json().catch(() => null);
        if (staffRes.ok && staffData?.success) {
          setStaffInbox(staffData.inbox ?? []);
          setStaffSent(staffData.sent ?? []);
          setTotalUnread((data.totalUnread ?? 0) + (staffData.unread ?? 0));
        } else {
          setStaffInbox([]);
          setStaffSent([]);
          setTotalUnread(data.totalUnread ?? 0);
        }
      }
      setExpandedId(null);
      setExpandedStaffId(null);
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

  async function toggleStaffMessage(m: StaffDirectMessage) {
    if (expandedStaffId === m.id) {
      setExpandedStaffId(null);
      return;
    }
    setExpandedStaffId(m.id);
    if (m.isRead === false) {
      try {
        const res = await fetch(`/api/staff-messages/${m.id}`, { method: "PATCH" });
        if (res.ok) {
          setStaffInbox((prev) =>
            prev.map((x) => (x.id === m.id ? { ...x, isRead: true } : x))
          );
          setTotalUnread((prev) => Math.max(0, prev - 1));
        }
      } catch {
        // Leaving it unread is safe: the next load re-fetches the flag.
      }
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
        body = `${note ? `${note}\n\n` : ""}Report sent: ${report.fileName}`.slice(0, 500);
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
    setComposeError(null);
    const missing: Promise<void>[] = [];
    if (clients.length === 0) {
      missing.push(
        fetch("/api/clients")
          .then((r) => r.json())
          .then((d) => {
            if (d.clients) setClients(d.clients);
          })
          .catch(() => undefined)
      );
    }
    if (staffList.length === 0) {
      missing.push(
        fetch("/api/staff")
          .then((r) => r.json())
          .then((d) => {
            if (d.staff) {
              setStaffList(
                d.staff.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))
              );
            }
          })
          .catch(() => undefined)
      );
    }
    if (invoiceOptions.length === 0) {
      setComposeLoading(true);
      missing.push(
        fetch("/api/invoices?limit=100")
          .then((r) => r.json())
          .then((d) => {
            if (!d.invoices) throw new Error(d.error || "Failed to load invoices");
            setInvoiceOptions(d.invoices);
          })
          .catch((err: any) => {
            setComposeError(err.message || "Failed to load invoices.");
          })
          .finally(() => setComposeLoading(false))
      );
    }
    await Promise.all(missing);
  }

  /** Newest invoice per client — the thread a common message lands on. */
  const latestByClient = useMemo(() => {
    const map = new Map<string, InvoiceOption>();
    for (const inv of invoiceOptions) {
      const clientId = inv.client?.id;
      if (!clientId) continue;
      const seen = map.get(clientId);
      if (!seen || new Date(inv.createdAt) > new Date(seen.createdAt)) map.set(clientId, inv);
    }
    return map;
  }, [invoiceOptions]);

  const composeRecipients = useMemo(() => {
    const known = new Map(clients.map((c) => [c.id, c.name]));
    for (const [id, inv] of latestByClient) {
      if (inv.client && !known.has(id)) known.set(id, inv.client.name);
    }
    return Array.from(known, ([id, name]) => {
      const inv = latestByClient.get(id);
      return {
        id,
        name,
        staffName: inv?.assignedStaff?.name ?? null,
        staffId: inv?.assignedStaff?.id ?? UNASSIGNED,
        deliverable: !!inv,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, latestByClient]);

  /** Which clients have any invoice handled by each staff member. */
  const clientsByStaff = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const inv of invoiceOptions) {
      const clientId = inv.client?.id;
      if (!clientId) continue;
      const staffId = inv.assignedStaff?.id ?? UNASSIGNED;
      const set = map.get(staffId) ?? new Set<string>();
      set.add(clientId);
      map.set(staffId, set);
    }
    return map;
  }, [invoiceOptions]);

  /** Picking a staff member ticks every client they handle. */
  const staffPickedClients = useRef<Set<string>>(new Set());

  useEffect(() => {
    const owned = new Set<string>();
    for (const staffId of composeStaffSel) {
      for (const clientId of clientsByStaff.get(staffId) ?? []) owned.add(clientId);
    }
    const previous = staffPickedClients.current;
    staffPickedClients.current = owned;
    setComposeClientSel((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of previous) {
        if (!owned.has(id) && next.delete(id)) changed = true;
      }
      for (const id of owned) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [clientsByStaff, composeStaffSel]);

  /** The To list shows exactly what is ticked (clients, or a picked staff's clients). */
  const selectedRecipients = useMemo(
    () => composeRecipients.filter((c) => composeClientSel.has(c.id)),
    [composeRecipients, composeClientSel]
  );

  /** Staff ticked in the To picker are listed as recipients too. */
  const selectedStaffRows = useMemo(
    () => staffList.filter((s) => composeStaffSel.has(s.id)),
    [staffList, composeStaffSel]
  );

  const recipientRows: RecipientRow[] = useMemo(
    () => [
      ...selectedRecipients.map(
        (c): RecipientRow => ({
          kind: "client",
          id: c.id,
          name: c.name,
          detail: c.staffName,
          deliverable: c.deliverable,
        })
      ),
      ...selectedStaffRows.map(
        (s): RecipientRow => ({ kind: "staff", id: `staff-${s.id}`, name: s.name })
      ),
    ],
    [selectedRecipients, selectedStaffRows]
  );

  const composeClientOptions: Option[] = useMemo(
    () => composeRecipients.map((c) => ({ value: c.id, label: c.name })),
    [composeRecipients]
  );

  const composeStaffOptions: Option[] = useMemo(
    () => [
      ...staffList.map((s) => ({ value: s.id, label: s.name })),
      { value: UNASSIGNED, label: "Unassigned" },
    ],
    [staffList]
  );

  function composeTargets() {
    return selectedRecipients
      .map((c) => latestByClient.get(c.id))
      .filter((inv): inv is InvoiceOption => !!inv);
  }

  async function saveComposeDraft() {
    const note = composeBody.trim();
    const targets = composeTargets();
    if (targets.length === 0 || !note) return;
    setComposeBusy(true);
    setComposeError(null);
    try {
      for (const inv of targets) {
        const res = await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: inv.id, body: note }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to save draft");
      }
      setComposeBody("");
      setComposeClientSel(new Set());
      setComposeStaffSel(new Set());
      setComposing(false);
      setFolder("drafts");
    } catch (err: any) {
      setComposeError(err.message || "Failed to save draft.");
    } finally {
      setComposeBusy(false);
    }
  }

  /** Common message: clients get it on their invoice thread, staff as a direct note. */
  async function sendCompose() {
    const note = composeBody.trim();
    if (recipientRows.length === 0 || !note) return;
    const targets = composeTargets();
    const staffTargets = selectedStaffRows;
    if (targets.length === 0 && staffTargets.length === 0) {
      setComposeError("The selected clients have no invoice yet, so there is no thread to send on.");
      return;
    }
    setComposeBusy(true);
    setComposeError(null);
    let sent = 0;
    const failed: string[] = [];
    for (const inv of targets) {
      try {
        const res = await fetch(`/api/invoices/${inv.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: note }),
        });
        if (!res.ok) throw new Error("failed");
        sent += 1;
      } catch {
        failed.push(inv.client?.name || "client");
      }
    }
    if (staffTargets.length > 0) {
      try {
        const res = await fetch("/api/staff-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientIds: staffTargets.map((s) => s.id), body: note }),
        });
        if (!res.ok) throw new Error("failed");
        sent += staffTargets.length;
      } catch {
        failed.push(...staffTargets.map((s) => s.name));
      }
    }
    if (failed.length === 0) {
      setComposeBody("");
      setComposeClientSel(new Set());
      setComposeStaffSel(new Set());
      setComposing(false);
      setFolder("sent");
    } else {
      setComposeError(`Sent to ${sent}; failed for ${failed.join(", ")}.`);
    }
    if (sent > 0) await load();
    setComposeBusy(false);
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim()) load();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!composeFilterRef.current?.contains(e.target as Node)) setComposeOpenFilter(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setComposeOpenFilter(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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

  const visibleStaffMessages = (folder === "sent" ? staffSent : staffInbox).filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const who = folder === "sent" ? m.recipient?.name : m.sender?.name;
    return `${who || ""} ${m.body}`.toLowerCase().includes(q);
  });

  const totalRows = threads.length + visibleStaffMessages.length;

  return (
    <AppShell
      role="admin"
      title="Messages"
      subtitle="Invoice Desk · Office Mailbox"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {totalUnread > 0 ? (
            <Badge className="hidden bg-blue-600 text-white sm:inline-flex">{totalUnread} unread</Badge>
          ) : null}
          <button
            type="button"
            onClick={openComposer}
            className="dc-btn dc-btn-pri inline-flex items-center gap-1.5"
          >
            <PenLine className="h-4 w-4" />
            Compose
          </button>
        </div>
      }
    >
      {composing && (
        <Card className="p-4">
          <div className="text-xs font-bold text-slate-800 mb-2">New message</div>

          <div className="mb-2 flex flex-wrap items-center gap-2" ref={composeFilterRef}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To</span>
            <CheckFilter
              label="Client"
              options={composeClientOptions}
              selected={composeClientSel}
              onChange={setComposeClientSel}
              open={composeOpenFilter === "client"}
              onToggle={() => setComposeOpenFilter((v) => (v === "client" ? null : "client"))}
              onClose={() => setComposeOpenFilter(null)}
            />
            <CheckFilter
              label="Staff"
              options={composeStaffOptions}
              selected={composeStaffSel}
              onChange={setComposeStaffSel}
              open={composeOpenFilter === "staff"}
              onToggle={() => setComposeOpenFilter((v) => (v === "staff" ? null : "staff"))}
              onClose={() => setComposeOpenFilter(null)}
            />
            {composeStaffSel.size > 0 ? (
              <button
                type="button"
                onClick={() => setComposeStaffSel(new Set())}
                className="text-[11px] text-slate-500 underline"
              >
                Reset staff
              </button>
            ) : null}
            <span className="ml-auto text-[11px] text-slate-500">
              {recipientRows.length} selected
            </span>
          </div>

          <div className="mb-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200">
            {composeLoading ? (
              <p className="px-3 py-3 text-[11px] text-slate-400">Loading clients…</p>
            ) : recipientRows.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-slate-400">
                No recipients selected — pick a client or a staff member.
              </p>
            ) : (
              recipientRows.map((r) =>
                r.kind === "staff" ? (
                  <div
                    key={r.id}
                    className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                      {r.name}
                    </span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Staff
                    </span>
                  </div>
                ) : (
                  <div
                    key={r.id}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 ${
                      r.deliverable ? "" : "opacity-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                      {r.name}
                    </span>
                    <span className="truncate text-[11px] text-slate-500">
                      {r.detail || "Unassigned"}
                    </span>
                  </div>
                )
              )
            )}
          </div>

          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your message…"
            rows={3}
            maxLength={500}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
          />

          {composeError ? (
            <p className="mt-2 text-[11px] text-red-600">{composeError}</p>
          ) : null}

          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={saveComposeDraft}
              disabled={composeBusy || !composeBody.trim() || selectedRecipients.length === 0}
              title={
                selectedRecipients.length === 0
                  ? "Drafts need at least one client invoice."
                  : undefined
              }
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {composeBusy ? "Saving…" : "Save draft"}
            </button>
            <button
              onClick={sendCompose}
              disabled={composeBusy || !composeBody.trim() || recipientRows.length === 0}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {composeBusy ? "Sending…" : "Send"}
            </button>
            <button onClick={() => setComposing(false)} className="text-xs text-slate-500 underline">
              Cancel
            </button>
            <span className="ml-auto text-[11px] text-slate-400">{composeBody.length}/500</span>
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
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                  {d.updatedAt ? new Date(d.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
              <textarea
                value={draftEdits[d.id] ?? d.body}
                onChange={(e) => setDraftEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                onBlur={() => saveDraftEdit(d)}
                rows={2}
                maxLength={500}
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
              {loading && totalRows === 0
                ? "…"
                : `${totalRows} email${totalRows === 1 ? "" : "s"}`}
            </span>
          </div>
          {totalRows === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">No threads found.</p>
              <p className="mt-1 text-xs text-slate-400">
                Messages with clients appear here, newest first.
              </p>
            </div>
          )}
          {loading && totalRows === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-500">Loading threads…</p>
            </div>
          )}
          {visibleStaffMessages.map((m) => {
            const isSentFolder = folder === "sent";
            const who = isSentFolder ? m.recipient?.name : m.sender?.name;
            const unread = !isSentFolder && m.isRead === false;
            const { subject, preview } = splitMessage(m.body);
            const open = expandedStaffId === m.id;
            return (
              <Card
                key={m.id}
                className={`overflow-hidden ${unread ? "bg-[#F5F9FF]" : "bg-white"}`}
              >
                <button
                  onClick={() => toggleStaffMessage(m)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-slate-700 truncate">
                        {who || "Staff"}
                      </span>
                      <Badge className="bg-slate-200 text-slate-700">Staff</Badge>
                      {unread && <Badge className="bg-blue-600 text-white">New</Badge>}
                    </span>
                    <span className="block text-[13px] font-bold text-slate-900 truncate">
                      {subject}
                    </span>
                    {open ? (
                      <span className="block whitespace-pre-wrap text-[11px] text-slate-600">
                        {m.body}
                      </span>
                    ) : preview ? (
                      <span className="block text-[11px] text-slate-500 truncate">
                        {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 truncate">
                        {isSentFolder ? `To ${who}` : `From ${who}`} · Office note
                      </span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {formatWhen(m.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              </Card>
            );
          })}
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
                      <span className="text-[11px] text-slate-500 truncate">
                        <span className="dc-mono">{t.jobNumber || t.invoiceNo || shortInvoiceId({ id: t.invoiceId })}</span>
                        {t.assignedStaff?.name ? ` · ${t.assignedStaff.name}` : ""}
                      </span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">{formatWhen(t.lastAt)}</span>
                    </span>
                  </span>
                  <span className="mt-1 text-slate-400">
                    {expandedId === t.invoiceId ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
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
                            <div className={`text-[11px] mt-1 ${m.senderType === "staff" ? "text-blue-100" : "text-slate-400"}`}>
                              {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {replyFiles[t.invoiceId] && (
                      <div className="mb-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-[11px] text-slate-700">
                        <Paperclip className="h-3 w-3" /> {replyFiles[t.invoiceId]!.name}
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
                        <Paperclip className="h-4 w-4 text-slate-500" />
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
                        maxLength={500}
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
