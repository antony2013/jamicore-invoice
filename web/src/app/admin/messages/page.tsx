"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
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

type EmailMessage = {
  id: string;
  invoiceId: string;
  senderType: string;
  senderName: string;
  body: string;
  createdAt: string;
  isReadByStaff: boolean;
  isReadByClient: boolean;
  invoice: {
    id: string;
    invoiceNo: string | null;
    jobNumber: string | null;
    status: string | null;
  };
  client: { id: string; name: string };
  assignedStaff: { id: string; name: string } | null;
};

type GeneralMessage = {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  senderType: string;
  senderName: string;
  body: string;
  createdAt: string;
  isReadByStaff: boolean;
  general: true;
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
  | { kind: "client"; id: string; name: string; detail: string | null }
  | { kind: "staff"; id: string; name: string };

type MailboxRow =
  | { kind: "email"; at: string; email: EmailMessage }
  | { kind: "general"; at: string; general: GeneralMessage }
  | { kind: "staff"; at: string; staff: StaffDirectMessage };

/** Which single message is open in the separate detail view. */
type ViewingMessage = { kind: "email" | "general" | "staff"; id: string };

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
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [staffInbox, setStaffInbox] = useState<StaffDirectMessage[]>([]);
  const [staffSent, setStaffSent] = useState<StaffDirectMessage[]>([]);
  const [viewing, setViewing] = useState<ViewingMessage | null>(null);
  const [generalMessages, setGeneralMessages] = useState<GeneralMessage[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  function mailQuery(): string {
    const p = new URLSearchParams();
    p.set("folder", folder === "sent" ? "sent" : "inbox");
    p.set("limit", "100");
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
        const [mailRes, generalRes, staffRes] = await Promise.all([
          fetch(`/api/messages?${mailQuery()}`),
          fetch(`/api/client-messages?${mailQuery()}`),
          fetch("/api/staff-messages"),
        ]);
        const data = await mailRes.json();
        if (!mailRes.ok) throw new Error(data.error || "Failed to load messages");
        setEmails(data.messages ?? []);

        const generalData = await generalRes.json().catch(() => null);
        setGeneralMessages(
          generalRes.ok && generalData?.success ? generalData.messages ?? [] : []
        );

        const staffData = await staffRes.json().catch(() => null);
        if (staffRes.ok && staffData?.success) {
          setStaffInbox(staffData.inbox ?? []);
          setStaffSent(staffData.sent ?? []);
          setTotalUnread(
            (data.totalUnread ?? 0) +
              (generalData?.totalUnread ?? 0) +
              (staffData.unread ?? 0)
          );
        } else {
          setStaffInbox([]);
          setStaffSent([]);
          setTotalUnread((data.totalUnread ?? 0) + (generalData?.totalUnread ?? 0));
        }
      }
    } catch (err: any) {
      setLoadError(err.message || "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }

  /** Open one email in its own detail view; a client email marks itself read. */
  async function openEmail(m: EmailMessage) {
    setViewing({ kind: "email", id: m.id });
    if (m.senderType === "client" && !m.isReadByStaff) {
      try {
        const res = await fetch(`/api/messages/${m.id}`, { method: "PATCH" });
        if (res.ok) {
          setEmails((prev) =>
            prev.map((x) => (x.id === m.id ? { ...x, isReadByStaff: true } : x))
          );
          setTotalUnread((prev) => Math.max(0, prev - 1));
        }
      } catch {
        // Leaving it unread is safe: the next load re-fetches the flag.
      }
    }
  }

  /** Open one general (invoice-free) email in its own detail view. */
  async function openGeneral(m: GeneralMessage) {
    setViewing({ kind: "general", id: m.id });
    if (m.senderType === "client" && !m.isReadByStaff) {
      try {
        const res = await fetch(`/api/client-messages/${m.id}`, { method: "PATCH" });
        if (res.ok) {
          setGeneralMessages((prev) =>
            prev.map((x) => (x.id === m.id ? { ...x, isReadByStaff: true } : x))
          );
          setTotalUnread((prev) => Math.max(0, prev - 1));
        }
      } catch {
        // Leaving it unread is safe: the next load re-fetches the flag.
      }
    }
  }

  /** Email-style reply to a general message — no invoice needed. */
  async function sendGeneralReply(m: GeneralMessage) {
    const note = (replies[m.id] || "").trim();
    if (!note) return;
    setSending(m.id);
    try {
      const res = await fetch("/api/client-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds: [m.clientId], body: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setReplies((prev) => ({ ...prev, [m.id]: "" }));
      await load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setSending(null);
    }
  }

  async function openStaffMessage(m: StaffDirectMessage) {
    setViewing({ kind: "staff", id: m.id });
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

  /** Reply to a staff note. It stays staff-only and never reaches a client. */
  async function sendStaffReply(m: StaffDirectMessage, toId?: string) {
    const note = (replies[m.id] || "").trim();
    if (!note || !toId) return;
    setSending(m.id);
    try {
      const res = await fetch("/api/staff-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientIds: [toId], body: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setReplies((prev) => ({ ...prev, [m.id]: "" }));
      await load();
    } catch (err: any) {
      setLoadError(err.message || "Failed to send message.");
    } finally {
      setSending(null);
    }
  }

  async function sendReply(invoiceId: string, draftId?: string, slot?: string) {
    // Reply boxes are per email row (slot = message id); the send stays invoice-based.
    const key = slot || invoiceId;
    const note = (replies[key] || "").trim();
    const file = replyFiles[key] || null;
    if (!note && !file) return;
    setSending(key);
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
      setReplies((prev) => ({ ...prev, [key]: "" }));
      setReplyFiles((prev) => ({ ...prev, [key]: null }));
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      }
      await load();
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
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, latestByClient]);

  /** The To list shows exactly what is ticked — clients and staff are independent. */
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

  /** Clients get a general email (no invoice needed); staff get a direct note. */
  async function sendCompose() {
    const note = composeBody.trim();
    if (recipientRows.length === 0 || !note) return;
    const clientTargets = selectedRecipients.map((c) => c.id);
    const staffTargets = selectedStaffRows;
    setComposeBusy(true);
    setComposeError(null);
    let sent = 0;
    const failed: string[] = [];
    if (clientTargets.length > 0) {
      try {
        const res = await fetch("/api/client-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientIds: clientTargets, body: note }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "failed");
        sent += clientTargets.length;
      } catch (err: any) {
        failed.push(
          `${selectedRecipients.map((c) => c.name).join(", ")}${
            err?.message ? ` (${err.message})` : ""
          }`
        );
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
    setViewing(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

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

  const q = search.trim().toLowerCase();

  const visibleEmails = emails.filter((m) => {
    if (!q) return true;
    const text = `${m.client.name} ${m.senderName} ${m.body} ${m.invoice.invoiceNo || ""} ${
      m.invoice.jobNumber || ""
    } ${m.assignedStaff?.name || ""}`;
    return text.toLowerCase().includes(q);
  });

  const visibleStaffMessages = (folder === "sent" ? staffSent : staffInbox).filter((m) => {
    if (!q) return true;
    const who = folder === "sent" ? m.recipient?.name : m.sender?.name;
    return `${who || ""} ${m.body}`.toLowerCase().includes(q);
  });

  const visibleGeneral = generalMessages.filter((m) => {
    if (!q) return true;
    return `${m.client.name} ${m.senderName} ${m.body}`.toLowerCase().includes(q);
  });

  const rows: MailboxRow[] = [
    ...visibleEmails.map((email) => ({ kind: "email" as const, at: email.createdAt, email })),
    ...visibleGeneral.map((general) => ({ kind: "general" as const, at: general.createdAt, general })),
    ...visibleStaffMessages.map((staff) => ({ kind: "staff" as const, at: staff.createdAt, staff })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const isViewingRow = (row: MailboxRow): boolean => {
    if (!viewing) return false;
    if (row.kind === "email") {
      return viewing.kind === "email" && viewing.id === row.email.id;
    }
    if (row.kind === "general") {
      return viewing.kind === "general" && viewing.id === row.general.id;
    }
    return viewing.kind === "staff" && viewing.id === row.staff.id;
  };

  // Resolve the open message from the raw lists so typing in search while the
  // detail view is open cannot blank the screen.
  const viewedRows: MailboxRow[] = useMemo(() => {
    if (!viewing) return [];
    if (viewing.kind === "email") {
      const email = emails.find((x) => x.id === viewing.id);
      return email ? [{ kind: "email" as const, at: email.createdAt, email }] : [];
    }
    if (viewing.kind === "general") {
      const general = generalMessages.find((x) => x.id === viewing.id);
      return general ? [{ kind: "general" as const, at: general.createdAt, general }] : [];
    }
    const staff = (folder === "sent" ? staffSent : staffInbox).find((x) => x.id === viewing.id);
    return staff ? [{ kind: "staff" as const, at: staff.createdAt, staff }] : [];
  }, [viewing, emails, generalMessages, folder, staffInbox, staffSent]);

  const shownRows = viewing ? viewedRows : rows;
  const totalRows = rows.length;

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
                    className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0"
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
              disabled={composeBusy || !composeBody.trim() || composeTargets().length === 0}
              title={
                composeTargets().length === 0
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
          {viewing ? (
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to {folder === "sent" ? "Sent" : "Inbox"}
            </button>
          ) : (
            <>
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
                  <p className="text-sm font-medium text-slate-600">No emails found.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {folder === "sent"
                      ? "Messages you send appear here, newest first."
                      : "Client messages appear here, newest first."}
                  </p>
                </div>
              )}
              {loading && totalRows === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
                  <p className="text-sm font-medium text-slate-500">Loading emails…</p>
                </div>
              )}
            </>
          )}
          {shownRows.map((row) => {
            if (row.kind === "general") {
              const m = row.general;
              const isSentFolder = folder === "sent";
              const unread = !isSentFolder && !m.isReadByStaff;
              const { subject, preview } = splitMessage(m.body);
              const open = isViewingRow(row);
              const sender = m.senderName || m.client.name;
              return (
                <Card
                  key={`general-${m.id}`}
                  className={`overflow-hidden ${unread ? "bg-[#F5F9FF]" : "bg-white"}`}
                >
                  <button
                    onClick={() => openGeneral(m)}
                    className="w-full flex items-start gap-3 p-4 text-left"
                  >
                    <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0 text-[12px] font-bold uppercase">
                      {(isSentFolder ? m.client.name : sender).slice(0, 1) || "?"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-[12px] font-semibold text-slate-700">
                          {isSentFolder ? `To ${m.client.name}` : sender}
                        </span>
                        {unread && <Badge className="bg-blue-600 text-white">New</Badge>}
                        <span className="ml-auto whitespace-nowrap text-[11px] text-slate-400">
                          {formatWhen(m.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[13px] font-bold text-slate-900 truncate">
                        {subject}
                      </span>
                      {!open && preview ? (
                        <span className="block text-[11px] text-slate-500 truncate">
                          {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                        <span>General message</span>
                        <span>· {m.client.name}</span>
                      </span>
                    </span>
                    <span className="mt-1 text-slate-400">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">From</span>
                          <span className="min-w-0 break-words">
                            {isSentFolder ? m.senderName || "Office" : sender}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">To</span>
                          <span className="min-w-0 break-words">
                            {isSentFolder ? m.client.name : "Office"}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">Date</span>
                          <span>{new Date(m.createdAt).toLocaleString()}</span>
                        </div>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
                        {m.body}
                      </p>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <textarea
                          value={replies[m.id] || ""}
                          onChange={(e) =>
                            setReplies((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          placeholder="Reply to this email…"
                          rows={2}
                          maxLength={500}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => sendGeneralReply(m)}
                            disabled={sending === m.id || !(replies[m.id] || "").trim()}
                            className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {sending === m.id ? "Sending…" : "Reply"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            }

            if (row.kind === "staff") {
              const m = row.staff;
              const isSentFolder = folder === "sent";
              const who = isSentFolder ? m.recipient?.name : m.sender?.name;
              const unread = !isSentFolder && m.isRead === false;
              const { subject, preview } = splitMessage(m.body);
              const open = isViewingRow(row);
              return (
                <Card
                  key={`staff-${m.id}`}
                  className={`overflow-hidden ${unread ? "bg-[#F5F9FF]" : "bg-white"}`}
                >
                  <button
                    onClick={() => openStaffMessage(m)}
                    className="w-full flex items-start gap-3 p-4 text-left"
                  >
                    <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-slate-700 truncate">
                          {isSentFolder ? `To ${who || "Staff"}` : who || "Staff"}
                        </span>
                        <Badge className="bg-slate-200 text-slate-700">Staff</Badge>
                        {unread && <Badge className="bg-blue-600 text-white">New</Badge>}
                        <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">
                          {formatWhen(m.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[13px] font-bold text-slate-900 truncate">
                        {subject}
                      </span>
                      {!open && preview ? (
                        <span className="block text-[11px] text-slate-500 truncate">
                          {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[11px] text-slate-400">
                        Office note {isSentFolder ? "sent" : "received"}
                      </span>
                    </span>
                    <span className="mt-1 text-slate-400">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">From</span>
                          <span className="min-w-0 break-words">
                            {isSentFolder ? "You" : m.sender?.name || "Staff"}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">To</span>
                          <span className="min-w-0 break-words">
                            {isSentFolder ? m.recipient?.name || "Staff" : "You"}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="w-10 shrink-0 font-semibold text-slate-500">Date</span>
                          <span>{new Date(m.createdAt).toLocaleString()}</span>
                        </div>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
                        {m.body}
                      </p>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <textarea
                          value={replies[m.id] || ""}
                          onChange={(e) =>
                            setReplies((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          placeholder="Reply to this staff note…"
                          rows={2}
                          maxLength={500}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() =>
                              sendStaffReply(
                                m,
                                isSentFolder ? m.recipient?.id : m.sender?.id
                              )
                            }
                            disabled={
                              sending === m.id ||
                              !(replies[m.id] || "").trim() ||
                              !(isSentFolder ? m.recipient?.id : m.sender?.id)
                            }
                            className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {sending === m.id ? "Sending…" : "Reply"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            }

            const m = row.email;
            const isSentFolder = folder === "sent";
            const unread = !isSentFolder && !m.isReadByStaff;
            const { subject, preview } = splitMessage(m.body);
            const open = isViewingRow(row);
            const sender = m.senderName || m.client.name;
            const meta =
              m.invoice.jobNumber || m.invoice.invoiceNo || shortInvoiceId({ id: m.invoiceId });
            return (
              <Card
                key={m.id}
                className={`overflow-hidden ${unread ? "bg-[#F5F9FF]" : "bg-white"}`}
              >
                <button
                  onClick={() => openEmail(m)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0 text-[12px] font-bold uppercase">
                    {(isSentFolder ? m.client.name : sender).slice(0, 1) || "?"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[12px] font-semibold text-slate-700">
                        {isSentFolder ? `To ${m.client.name}` : sender}
                      </span>
                      {unread && <Badge className="bg-blue-600 text-white">New</Badge>}
                      <span className="ml-auto whitespace-nowrap text-[11px] text-slate-400">
                        {formatWhen(m.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] font-bold text-slate-900 truncate">
                      {subject}
                    </span>
                    {!open && preview ? (
                      <span className="block text-[11px] text-slate-500 truncate">
                        {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                      <span className="dc-mono">{meta}</span>
                      <span>· {m.client.name}</span>
                      {isSentFolder && m.senderName ? <span>· {m.senderName}</span> : null}
                    </span>
                  </span>
                  <span className="mt-1 text-slate-400">
                    {open ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                      <div className="flex gap-1.5">
                        <span className="w-10 shrink-0 font-semibold text-slate-500">From</span>
                        <span className="min-w-0 break-words">
                          {isSentFolder ? m.senderName || "Office" : sender}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-10 shrink-0 font-semibold text-slate-500">To</span>
                        <span className="min-w-0 break-words">
                          {isSentFolder ? m.client.name : "Office"}
                          {!isSentFolder && m.assignedStaff?.name
                            ? ` · ${m.assignedStaff.name}`
                            : ""}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-10 shrink-0 font-semibold text-slate-500">Ref</span>
                        <span className="dc-mono min-w-0 break-words">{meta}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-10 shrink-0 font-semibold text-slate-500">Date</span>
                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
                      {m.body}
                    </p>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        {replyFiles[m.id] && (
                          <div className="mb-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                            <Paperclip className="h-3 w-3" /> {replyFiles[m.id]!.name}
                            <button
                              onClick={() =>
                                setReplyFiles((prev) => ({ ...prev, [m.id]: null }))
                              }
                              className="text-slate-500 hover:text-slate-800"
                              aria-label="Remove attachment"
                            >
                              ×
                            </button>
                          </div>
                        )}
                        <textarea
                          id={`reply-${m.id}`}
                          value={replies[m.id] || ""}
                          onChange={(e) =>
                            setReplies((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          placeholder={
                            replyFiles[m.id]
                              ? "Add a note with the report…"
                              : "Reply to this email…"
                          }
                          rows={2}
                          maxLength={500}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <label
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
                            title="Attach report (.xlsx)"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            <span>
                              {replyFiles[m.id] ? "Change report" : "Attach report (.xlsx)"}
                            </span>
                            <input
                              type="file"
                              accept=".xlsx"
                              className="hidden"
                              onChange={(e) => {
                                const picked = e.target.files?.[0] ?? null;
                                setReplyFiles((prev) => ({ ...prev, [m.id]: picked }));
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            onClick={() => sendReply(m.invoiceId, undefined, m.id)}
                            disabled={
                              sending === m.id ||
                              (!(replies[m.id] || "").trim() && !replyFiles[m.id])
                            }
                            className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {sending === m.id
                              ? "Sending…"
                              : replyFiles[m.id]
                                ? "Send report"
                                : "Reply"}
                          </button>
                        </div>
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
