"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";

import AppShell from "@/components/AppShell";
import ChatWidget from "@/components/ChatWidget";
import { shortInvoiceId } from "@/lib/utils";

type Invoice = {
  id: string;
  status: string;
  category?: string | null;
  outlet?: { name?: string | null } | null;
  client?: { name?: string | null } | null;
  ocrData?: { amount?: number | string | null; invoiceNo?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
};

const STATUS_META: Record<
  string,
  { label: string; className: string; group: string }
> = {
  uploaded: {
    label: "Need to start",
    className: "bg-orange-50 text-orange-600 border-orange-200",
    group: "need_start",
  },
  ocr_failed: {
    label: "Need to start",
    className: "bg-orange-50 text-orange-600 border-orange-200",
    group: "need_start",
  },
  ocr_pending: {
    label: "In progress",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    group: "progress",
  },
  ocr_done: {
    label: "In progress",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    group: "progress",
  },
  assigned: {
    label: "In progress",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    group: "progress",
  },
  in_review: {
    label: "In progress",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    group: "progress",
  },
  needs_info: {
    label: "In progress",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    group: "progress",
  },
  verified: {
    label: "Verified",
    className: "bg-emerald-50 text-emerald-600 border-emerald-200",
    group: "verified",
  },
  collected: {
    label: "Finished",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    group: "finished",
  },
  disputed: {
    label: "Returned",
    className: "bg-red-50 text-red-600 border-red-200",
    group: "returned",
  },
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "need_start", label: "Need to start" },
  { key: "progress", label: "In progress" },
  { key: "verified", label: "Verified" },
  { key: "finished", label: "Finished" },
  { key: "returned", label: "Returned" },
];

const CATEGORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "sales_invoice", label: "Sales Invoice" },
  { key: "expense_bill", label: "Expenses Bill" },
  { key: "purchase_bill", label: "Purchase Bill" },
  { key: "asset_bill", label: "Assets" },
  { key: "other", label: "Others" },
];

const BILL_CATEGORIES = ["purchase_bill", "expense_bill", "asset_bill", "other"];

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatAmount(inv: Invoice): string {
  const raw = inv.ocrData?.amount;
  const num = typeof raw === "string" ? Number(raw) : raw;
  if (num === null || num === undefined || Number.isNaN(Number(num))) return "MVR —";
  return `MVR ${Number(num).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status,
      className: "bg-slate-100 text-slate-600 border-slate-200",
      group: "other",
    }
  );
}

export default function StaffOutletPage({
  params,
}: {
  params: Promise<{ id: string; outletId: string }>;
}) {
  const { id, outletId } = use(params);
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ assigned_to: "me", client: id, limit: "100" });
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load outlet");
      const list = ((data.invoices ?? []) as Invoice[]).filter(
        (inv: any) => (inv.outletId || inv.outlet?.id || "none") === outletId
      );
      setInvoices(list);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load outlet.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, outletId]);

  const clientName = invoices.find((inv) => inv.client?.name)?.client?.name ?? "";
  const outletName =
    invoices.find((inv) => inv.outlet?.name)?.outlet?.name ??
    (outletId === "none" ? "No outlet" : "Outlet");

  const counts = useMemo(() => {
    const base = { updated: invoices.length, progress: 0, verified: 0, finished: 0 };
    for (const inv of invoices) {
      const group = statusMeta(inv.status).group;
      if (group === "progress") base.progress += 1;
      if (group === "verified") base.verified += 1;
      if (group === "finished") base.finished += 1;
    }
    return base;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      const category = inv.category || "sales_invoice";
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      if (statusFilter !== "all" && statusMeta(inv.status).group !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        inv.ocrData?.invoiceNo || "",
        inv.id,
        category,
        inv.outlet?.name || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [invoices, categoryFilter, statusFilter, query]);

  const invoiceColumn = filtered.filter(
    (inv) => !BILL_CATEGORIES.includes(inv.category || "sales_invoice")
  );
  const billColumn = filtered.filter((inv) =>
    BILL_CATEGORIES.includes(inv.category || "sales_invoice")
  );

  function renderInvoice(inv: Invoice) {
    const meta = statusMeta(inv.status);
    return (
      <button
        key={inv.id}
        onClick={() => router.push(`/staff/invoices/${inv.id}`)}
        className="w-full text-left rounded-lg border border-[#E4E7EC] bg-white p-3 hover:shadow-md transition"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">
              {shortInvoiceId(inv)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              Uploaded {formatDate(inv.createdAt)}
              {inv.updatedAt ? ` · Updated ${formatDate(inv.updatedAt)}` : ""}
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${meta.className}`}
          >
            {meta.label}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-slate-900">{formatAmount(inv)}</span>
          <span className="flex items-center gap-1.5 min-w-0">
            {inv.outlet?.name ? (
              <span className="text-[10px] text-slate-400 truncate">{inv.outlet.name}</span>
            ) : null}
          </span>
        </div>
      </button>
    );
  }

  function renderColumn(title: string, list: Invoice[]) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <span className="text-[11px] text-slate-400">{list.length} items</span>
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-slate-400">No {title.toLowerCase()} found.</p>
        ) : (
          <div className="space-y-2">{list.map(renderInvoice)}</div>
        )}
      </section>
    );
  }

  return (
    <AppShell
      role="staff"
      title={outletName}
      hideHeader
      nav={[
        { href: `/staff/messages?client=${id}`, label: "Messages" },
        { href: `/staff/reports?client=${id}`, label: "Reports" },
      ]}
    >
      <Link
        href={`/staff/clients/${id}`}
        className="-mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to client
      </Link>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError}{" "}
          <button onClick={load} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      <div className="rounded-xl border border-[#E4E7EC] bg-gradient-to-r from-white to-[#F4F8FF] p-5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900 truncate">{outletName}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {clientName ? `${clientName} · ` : ""}Outlet account overview
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#E4E7EC] bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Report Options</h2>
          <span className="text-[11px] text-slate-400">Updated just now</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Total updated</div>
            <div className="text-lg font-bold text-slate-900">
              {loading && invoices.length === 0 ? "…" : counts.updated}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">In progress</div>
            <div className="text-lg font-bold text-slate-900">
              {loading && invoices.length === 0 ? "…" : counts.progress}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Verified</div>
            <div className="text-lg font-bold text-slate-900">
              {loading && invoices.length === 0 ? "…" : counts.verified}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Finished</div>
            <div className="text-lg font-bold text-slate-900">
              {loading && invoices.length === 0 ? "…" : counts.finished}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-500">Sections</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                  categoryFilter === cat.key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st.key}
                onClick={() => setStatusFilter(st.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                  statusFilter === st.key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoice ID or document type…"
          className="w-full rounded-lg border border-[#E4E7EC] bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {loading && invoices.length === 0 ? (
        <p className="text-xs text-slate-400">Loading invoices…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderColumn("Invoices", invoiceColumn)}
          {renderColumn("Bills", billColumn)}
        </div>
      )}

      <ChatWidget
        clientId={id}
        scopeId={outletId}
        outletLabel={outletName}
      />
    </AppShell>
  );
}
