"use client";
import { shortInvoiceId } from "@/lib/utils";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  FileBarChart,
  FileText,
  MessageSquare,
  Plus,
  Settings2,
  Store,
  Trash2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  CLIENT_RECORD_STATUSES,
  CLIENT_RECORD_STATUS_LABELS,
  CLIENT_RECORD_TYPES,
  CLIENT_RECORD_TYPE_LABELS,
  CLIENT_RECORD_TYPE_PLURALS,
} from "@/lib/client-records";
import {
  BILLING_TYPE_LABELS,
  BUSINESS_TYPE_LABELS,
  CLIENT_STATUS_LABELS,
  PAYMENT_TERMS_LABELS,
  PRIMARY_SERVICE_LABELS,
  BILLING_TYPES,
  BUSINESS_TYPES,
  CLIENT_STATUSES,
  PAYMENT_TERMS,
  PRIMARY_SERVICES,
} from "@/lib/client-profile";

// Invoice statuses that still count as a running job for an outlet.
const RUNNING_STATUSES = new Set<string>(["uploaded", "assigned", "in_review", "needs_info"]);

export default function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [client, setClient] = useState<any | null>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [reportsCapped, setReportsCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState<string | null>(null);
  const [outletName, setOutletName] = useState("");
  const [outletAddress, setOutletAddress] = useState("");
  const [outletPhone, setOutletPhone] = useState("");
  const [outletError, setOutletError] = useState<string | null>(null);
  const [savingOutlet, setSavingOutlet] = useState(false);
  const [showOutletForm, setShowOutletForm] = useState(false);
  const [busyOutletId, setBusyOutletId] = useState<string | null>(null);
  const [staffMenuOutletId, setStaffMenuOutletId] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    phone: "",
    email: "",
    contactPerson: "",
    businessType: "company",
    registrationNumber: "",
    primaryService: "administration",
    serviceStartDate: "",
    status: "active",
    billingType: "monthly",
    baseFee: "0",
    paymentTerms: "10_days_after_approval",
    extraWorkAllowed: true,
    internalNotes: "",
    assignedStaffId: "",
  });
  const [records, setRecords] = useState<any[]>([]);
  const [recordTypeFilter, setRecordTypeFilter] = useState<string>("service");
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [savingRecord, setSavingRecord] = useState(false);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [recordDraft, setRecordDraft] = useState({
    title: "",
    amount: "0",
    recordDate: "",
    status: "pending",
    assignedTo: "",
    description: "",
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, outletRes, repRes, staffRes, invRes, recordRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/outlets?clientId=${encodeURIComponent(id)}`),
        fetch(`/api/reports?client=${encodeURIComponent(id)}&limit=50`),
        fetch("/api/staff"),
        fetch(`/api/invoices?client=${encodeURIComponent(id)}&limit=100`),
        fetch(`/api/client-records?clientId=${encodeURIComponent(id)}`),
      ]);
      const clientData = await clientRes.json();
      const outletData = await outletRes.json();
      const repData = await repRes.json();
      const staffData = await staffRes.json();
      const invData = await invRes.json();
      const recordData = await recordRes.json();
      if (clientData.success) {
        const found = (clientData.clients as any[]).find((c) => c.id === id);
        if (!found) throw new Error("Client not found.");
        setClient(found);
        setAddressDraft(found.address || "");
      }
      if (!outletData.success) throw new Error(outletData.error || "Failed to load outlets");
      setOutlets(outletData.outlets);
      if (!repData.success) throw new Error(repData.error || "Failed to load reports");
      setReports(repData.reports);
      setReportsCapped(Boolean(repData.nextCursor));
      if (staffData.success) {
        setStaffList(
          staffData.staff.filter((s: any) => s.role === "staff" && s.isActive !== false)
        );
      }
      if (invData.success) setInvoices(invData.invoices ?? []);
      if (recordData.success) setRecords(recordData.records ?? []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load client workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddOutlet(e: React.FormEvent) {
    e.preventDefault();
    setOutletError(null);
    if (outletName.trim().length < 2) {
      setOutletError("Outlet name must be at least 2 characters.");
      return;
    }
    const ph = outletPhone.trim();
    if (ph && !/^\+\d{7,15}$/.test(ph)) {
      setOutletError("Outlet phone must be E.164 format, e.g. +18765550123.");
      return;
    }
    setSavingOutlet(true);
    try {
      const res = await fetch("/api/outlets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: id,
          name: outletName.trim(),
          ...(outletAddress.trim() ? { address: outletAddress.trim() } : {}),
          ...(ph ? { phone: ph } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create outlet");
      setOutlets((prev) => [...prev, data.outlet]);
      setOutletName("");
      setOutletAddress("");
      setOutletPhone("");
      setShowOutletForm(false);
    } catch (err: any) {
      setOutletError(err.message);
    } finally {
      setSavingOutlet(false);
    }
  }

  async function handleOutletStaffMulti(outletId: string, staffId: string, checked: boolean) {
    const outlet = outlets.find((o) => o.id === outletId);
    const next = new Set<string>((outlet?.staffIds as string[]) ?? []);
    if (checked) next.add(staffId);
    else next.delete(staffId);
    await saveOutletStaff(outletId, Array.from(next));
  }

  async function saveOutletStaff(outletId: string, staffIds: string[]) {
    setOutletError(null);
    setBusyOutletId(outletId);
    try {
      const res = await fetch(`/api/outlets/${outletId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffIds }),
      });
      const data = await res.json().catch(() => ({}));
      // A stale tab can hold an outlet that was deleted meanwhile — refresh
      // the list instead of leaving a dead row on screen.
      if (res.status === 404) {
        setOutletError("This outlet no longer exists. The outlet list has been refreshed.");
        await load();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to assign staff");
      const names = staffIds
        .map((sid) => staffList.find((s) => s.id === sid)?.name)
        .filter(Boolean) as string[];
      setOutlets((prev) =>
        prev.map((o) => (o.id === outletId ? { ...o, staffIds, staffNames: names } : o))
      );
    } catch (err: any) {
      setOutletError(err.message);
    } finally {
      setBusyOutletId(null);
    }
  }

  async function handleDeleteOutlet(outletId: string) {
    if (!confirm("Delete this outlet? Invoices must be unlinked first.")) return;
    setOutletError(null);
    setBusyOutletId(outletId);
    try {
      const res = await fetch(`/api/outlets/${outletId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setOutletError("This outlet no longer exists. The outlet list has been refreshed.");
        await load();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to delete outlet");
      setOutlets((prev) => prev.filter((o) => o.id !== outletId));
    } catch (err: any) {
      setOutletError(err.message);
    } finally {
      setBusyOutletId(null);
    }
  }

  async function saveAddress() {
    setDetailError(null);
    setSavingAddress(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addressDraft.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save address");
      setClient((prev: any) => (prev ? { ...prev, address: data.client?.address ?? null } : prev));
      setAddressDraft(data.client?.address ?? "");
      setEditingAddress(false);
    } catch (err: any) {
      setDetailError(err.message || "Failed to save address");
    } finally {
      setSavingAddress(false);
    }
  }

  function startEditProfile() {
    if (!client) return;
    setDetailError(null);
    setProfileDraft({
      name: client.name ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
      contactPerson: client.contactPerson ?? "",
      businessType: client.businessType ?? "company",
      registrationNumber: client.registrationNumber ?? "",
      primaryService: client.primaryService ?? "administration",
      serviceStartDate: client.serviceStartDate ?? "",
      status: client.status ?? "active",
      billingType: client.billingType ?? "monthly",
      baseFee: String(client.baseFee ?? "0"),
      paymentTerms: client.paymentTerms ?? "10_days_after_approval",
      extraWorkAllowed: client.extraWorkAllowed !== false,
      internalNotes: client.internalNotes ?? "",
      assignedStaffId: client.assignedStaffId ?? "",
    });
    setEditingProfile(true);
  }

  async function saveProfile() {
    setDetailError(null);
    const feeNumber = Number(profileDraft.baseFee);
    if (!Number.isFinite(feeNumber) || feeNumber < 0) {
      setDetailError("Base service fee must be a non-negative number.");
      return;
    }
    if (profileDraft.phone.trim() && !/^\+\d{7,15}$/.test(profileDraft.phone.trim())) {
      setDetailError("Phone must be E.164 format, e.g. +18765550123.");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileDraft.name.trim(),
          phone: profileDraft.phone.trim() || null,
          email: profileDraft.email.trim() || null,
          address: addressDraft.trim() || null,
          contactPerson: profileDraft.contactPerson.trim() || null,
          businessType: profileDraft.businessType,
          registrationNumber: profileDraft.registrationNumber.trim() || null,
          primaryService: profileDraft.primaryService,
          serviceStartDate: profileDraft.serviceStartDate || null,
          status: profileDraft.status,
          billingType: profileDraft.billingType,
          baseFee: feeNumber,
          paymentTerms: profileDraft.paymentTerms,
          extraWorkAllowed: profileDraft.extraWorkAllowed,
          internalNotes: profileDraft.internalNotes.trim() || null,
          assignedStaffId: profileDraft.assignedStaffId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save client profile");
      setClient((prev: any) => (prev ? { ...prev, ...data.client } : prev));
      setEditingProfile(false);
      setEditingAddress(false);
    } catch (err: any) {
      setDetailError(err.message || "Failed to save client profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    setRecordError(null);
    if (recordDraft.title.trim().length < 1) {
      setRecordError("Title / reference is required.");
      return;
    }
    const amount = Number(recordDraft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setRecordError("Amount must be a non-negative number.");
      return;
    }
    setSavingRecord(true);
    try {
      const res = await fetch("/api/client-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: id,
          type: recordTypeFilter,
          title: recordDraft.title.trim(),
          amount,
          ...(recordDraft.recordDate ? { recordDate: recordDraft.recordDate } : {}),
          status: recordDraft.status,
          ...(recordDraft.assignedTo.trim() ? { assignedTo: recordDraft.assignedTo.trim() } : {}),
          ...(recordDraft.description.trim() ? { description: recordDraft.description.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save record");
      setRecords((prev) => [data.record, ...prev]);
      setRecordDraft({
        title: "",
        amount: "0",
        recordDate: "",
        status: "pending",
        assignedTo: "",
        description: "",
      });
      setShowRecordForm(false);
    } catch (err: any) {
      setRecordError(err.message || "Failed to save record");
    } finally {
      setSavingRecord(false);
    }
  }

  async function deleteRecord(recordId: string) {
    if (!confirm("Delete this record?")) return;
    setRecordError(null);
    setBusyRecordId(recordId);
    try {
      const res = await fetch(`/api/client-records/${recordId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete record");
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
    } catch (err: any) {
      setRecordError(err.message || "Failed to delete record");
    } finally {
      setBusyRecordId(null);
    }
  }

  async function openReport(rep: any) {
    if (!rep.invoice) return;
    setFetchingUrl(rep.id);
    try {
      const res = await fetch(`/api/invoices/${rep.invoice.id}/report`);
      const data = await res.json();
      if (!res.ok || !data.report?.downloadUrl) throw new Error(data.error || "No file available");
      window.open(data.report.downloadUrl, "_blank", "noopener");
    } catch (err: any) {
      setLoadError(err.message || "Failed to open report.");
    } finally {
      setFetchingUrl(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const workspaceTiles = [
    {
      href: `/admin/clients/${id}/reports`,
      icon: FileBarChart,
      title: "Reports",
      subtitle: "Upload and view documents",
    },
    {
      href: "/admin/clients",
      icon: MessageSquare,
      title: "Messages",
      subtitle: "Communicate with client",
    },
    {
      href: "/admin/clients",
      icon: Settings2,
      title: "Account details",
      subtitle: "Business and contact settings",
    },
  ];

  // Open work per outlet: anything not yet verified/collected/returned.
  const runningByOutlet = invoices.reduce<Record<string, number>>((acc, inv) => {
    if (!inv?.outletId || !RUNNING_STATUSES.has(inv.status)) return acc;
    acc[inv.outletId] = (acc[inv.outletId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppShell role="admin" title={client ? client.name : "Client"} hideHeader>
      <div className="w-full max-w-4xl">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to clients
        </Link>

        {loadError && (
          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
            {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">
                {client ? client.name : loading ? "Loading…" : "Client"}
              </h1>
              <p className="text-xs text-slate-500">Client account overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {client && !client.archivedAt && (
              <button
                type="button"
                onClick={() => {
                  setShowOutletForm((v) => !v);
                  setOutletError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add Outlet
              </button>
            )}
            {client && !client.archivedAt && (
              <span
                className={`rounded px-2 py-1 text-[11px] font-bold uppercase ${
                  client.status === "active"
                    ? "bg-emerald-100 text-emerald-700"
                    : client.status === "suspended"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-200 text-slate-600"
                }`}
              >
                {CLIENT_STATUS_LABELS[client.status] ?? client.status ?? "Active"}
              </span>
            )}
            {client?.archivedAt && (
              <span className="rounded bg-slate-200 px-2 py-1 text-[11px] font-bold uppercase text-slate-600">
                Archived
              </span>
            )}
          </div>
        </div>

        {showOutletForm && (
          <form
            onSubmit={handleAddOutlet}
            className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="mb-3 text-sm font-bold text-slate-900">Add Outlet</div>
            {outletError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
                {outletError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Outlet name *
                </label>
                <input
                  value={outletName}
                  onChange={(e) => setOutletName(e.target.value)}
                  placeholder="e.g. Main Street branch"
                  required
                  minLength={2}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Phone (optional)
                </label>
                <input
                  value={outletPhone}
                  onChange={(e) => setOutletPhone(e.target.value)}
                  placeholder="+18765550123"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Address (optional)
                </label>
                <input
                  value={outletAddress}
                  onChange={(e) => setOutletAddress(e.target.value)}
                  placeholder="Street, area, city"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={savingOutlet}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {savingOutlet ? "Adding…" : "Add outlet"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowOutletForm(false);
                  setOutletError(null);
                  setOutletName("");
                  setOutletAddress("");
                  setOutletPhone("");
                }}
                disabled={savingOutlet}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">Outlets</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{outlets.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] text-slate-500">Reports</div>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {reports.length}{reportsCapped ? "+" : ""}
            </div>
          </div>
        </div>

        <div className="mt-6 mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Client details</h3>
          {client && !editingProfile && (
            <button
              type="button"
              onClick={startEditProfile}
              className="text-[11px] font-medium text-blue-600 hover:underline"
            >
              Edit client
            </button>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {detailError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
              {detailError}
            </div>
          )}
          {editingProfile ? (
            <div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Client / Company Name *</label>
                  <input
                    value={profileDraft.name}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Contact Person</label>
                  <input
                    value={profileDraft.contactPerson}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, contactPerson: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Business Type</label>
                  <select
                    value={profileDraft.businessType}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, businessType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {BUSINESS_TYPES.map((v) => (
                      <option key={v} value={v}>{BUSINESS_TYPE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    value={profileDraft.email}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Phone (E.164)</label>
                  <input
                    value={profileDraft.phone}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+18765550123"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Registration Number</label>
                  <input
                    value={profileDraft.registrationNumber}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, registrationNumber: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Primary Service</label>
                  <select
                    value={profileDraft.primaryService}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, primaryService: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PRIMARY_SERVICES.map((v) => (
                      <option key={v} value={v}>{PRIMARY_SERVICE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Service Start Date</label>
                  <input
                    type="date"
                    value={profileDraft.serviceStartDate}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, serviceStartDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Client Status</label>
                  <select
                    value={profileDraft.status}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CLIENT_STATUSES.map((v) => (
                      <option key={v} value={v}>{CLIENT_STATUS_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Assigned Staff (default)</label>
                  <select
                    value={profileDraft.assignedStaffId}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, assignedStaffId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Manual assignment</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Billing Type</label>
                  <select
                    value={profileDraft.billingType}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, billingType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {BILLING_TYPES.map((v) => (
                      <option key={v} value={v}>{BILLING_TYPE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Base Service Fee (KWD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={profileDraft.baseFee}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, baseFee: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Payment Terms</label>
                  <select
                    value={profileDraft.paymentTerms}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, paymentTerms: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PAYMENT_TERMS.map((v) => (
                      <option key={v} value={v}>{PAYMENT_TERMS_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Extra Work Charges Allowed</label>
                  <select
                    value={profileDraft.extraWorkAllowed ? "yes" : "no"}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, extraWorkAllowed: e.target.value === "yes" }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Address</label>
                  <textarea
                    value={addressDraft}
                    onChange={(e) => setAddressDraft(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Address is saved together with the profile.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Internal Notes (admin only)</label>
                  <input
                    value={profileDraft.internalNotes}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, internalNotes: e.target.value }))}
                    maxLength={2000}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await saveProfile();
                  }}
                  disabled={savingProfile || savingAddress}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingProfile || savingAddress ? "Saving…" : "Save client"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProfile(false);
                    setDetailError(null);
                    setAddressDraft(client?.address || "");
                  }}
                  disabled={savingProfile || savingAddress}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] text-slate-500">Status</div>
                <div className="mt-0.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${
                      client?.status === "active"
                        ? "bg-emerald-100 text-emerald-700"
                        : client?.status === "suspended"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {CLIENT_STATUS_LABELS[client?.status] ?? client?.status ?? "active"}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">User ID</div>
                <div className="font-mono text-xs text-slate-800">{client?.username || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Contact Person</div>
                <div className="text-xs text-slate-800">{client?.contactPerson || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Business Type</div>
                <div className="text-xs text-slate-800">
                  {BUSINESS_TYPE_LABELS[client?.businessType] ?? client?.businessType ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Phone</div>
                <div className="font-mono text-xs text-slate-800">{client?.phone || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Email</div>
                <div className="text-xs text-slate-800">{client?.email || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Registration Number</div>
                <div className="text-xs text-slate-800">{client?.registrationNumber || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Primary Service</div>
                <div className="text-xs text-slate-800">
                  {PRIMARY_SERVICE_LABELS[client?.primaryService] ?? client?.primaryService ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Service Start Date</div>
                <div className="text-xs text-slate-800">{client?.serviceStartDate || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Assigned Staff (default)</div>
                <div className="text-xs text-slate-800">{client?.assignedStaffName || "Manual"}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Billing Type</div>
                <div className="text-xs text-slate-800">
                  {BILLING_TYPE_LABELS[client?.billingType] ?? client?.billingType ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Base Service Fee</div>
                <div className="text-xs text-slate-800">{Number(client?.baseFee || 0).toFixed(3)} KWD</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Payment Terms</div>
                <div className="text-xs text-slate-800">
                  {PAYMENT_TERMS_LABELS[client?.paymentTerms] ?? client?.paymentTerms ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Extra Work Charges</div>
                <div className="text-xs text-slate-800">{client?.extraWorkAllowed === false ? "Not allowed" : "Allowed"}</div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-[11px] text-slate-500">Internal Notes</div>
                <div className="whitespace-pre-line text-xs text-slate-800">{client?.internalNotes || "—"}</div>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">Address</div>
                  {!editingAddress && client && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddressDraft(client.address || "");
                        setDetailError(null);
                        setEditingAddress(true);
                      }}
                      className="text-[11px] font-medium text-blue-600 hover:underline"
                    >
                      {client.address ? "Edit" : "Add address"}
                    </button>
                  )}
                </div>
                {editingAddress ? (
                  <div className="mt-1">
                    <textarea
                      value={addressDraft}
                      onChange={(e) => setAddressDraft(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="Street, area, city, postal code"
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={saveAddress}
                        disabled={savingAddress}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingAddress ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAddress(false);
                          setAddressDraft(client?.address || "");
                          setDetailError(null);
                        }}
                        disabled={savingAddress}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 whitespace-pre-line text-xs text-slate-800">
                    {client?.address || "—"}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <h3 className="mt-6 mb-2 text-sm font-bold text-slate-900">Client workspace</h3>
        <div className="grid grid-cols-2 gap-3">
          {workspaceTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.title}
                href={tile.href}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md"
              >
                <Icon className="h-5 w-5 text-blue-600" />
                <div className="mt-3 text-sm font-bold text-slate-900">{tile.title}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{tile.subtitle}</div>
              </Link>
            );
          })}
        </div>

        <h3 id="assigned-outlets" className="mt-6 mb-2 text-sm font-bold text-slate-900">Assigned outlets</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {outlets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">
                {loading ? "Loading outlets…" : "No outlets yet."}
              </p>
              {!loading && (
                <p className="mt-1 text-xs text-slate-400">Use Add Outlet above to create the first one.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {outlets.map((o) => {
                const selectedStaff = new Set<string>((o.staffIds as string[]) ?? []);
                return (
                  <div key={o.id} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Store className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{o.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {[o.address, o.phone].filter(Boolean).join(" · ") || "No address or phone"}
                        </div>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-center">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Running jobs
                          </div>
                          <div className="text-base font-bold leading-tight text-slate-900">
                            {runningByOutlet[o.id] ?? 0}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteOutlet(o.id)}
                          disabled={busyOutletId === o.id}
                          className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="relative mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
                        Assigned staff
                      </div>
                      {staffList.length === 0 ? (
                        <p className="text-[11px] text-slate-400">
                          No staff accounts yet — add one under Staff.
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setStaffMenuOutletId(staffMenuOutletId === o.id ? null : o.id)
                            }
                            disabled={busyOutletId === o.id}
                            className="flex w-full max-w-[280px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-left text-xs text-slate-700 outline-none hover:bg-slate-100 disabled:opacity-50"
                            title="Select staff for this outlet"
                          >
                            <span className="truncate">
                              {selectedStaff.size === 0
                                ? "Select staff"
                                : staffList
                                    .filter((s) => selectedStaff.has(s.id))
                                    .map((s) => s.name)
                                    .join(", ")}
                            </span>
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                          </button>
                          {staffMenuOutletId === o.id && (
                            <>
                              <button
                                type="button"
                                aria-label="Close staff menu"
                                className="fixed inset-0 z-40 cursor-default"
                                onClick={() => setStaffMenuOutletId(null)}
                              />
                              <div className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                                {staffList.map((s) => (
                                  <label
                                    key={s.id}
                                    className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 ${
                                      busyOutletId === o.id
                                        ? "opacity-60"
                                        : "cursor-pointer"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedStaff.has(s.id)}
                                      onChange={(e) =>
                                        handleOutletStaffMulti(o.id, s.id, e.target.checked)
                                      }
                                      disabled={busyOutletId === o.id}
                                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-700">{s.name}</span>
                                  </label>
                                ))}
                              </div>
                            </>
                          )}
                          <div className="mt-1.5 text-[11px] text-slate-500">
                            {selectedStaff.size} staff assigned
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Client records</h3>
          {client && (
            <button
              type="button"
              onClick={() => {
                setShowRecordForm((v) => !v);
                setRecordError(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add {CLIENT_RECORD_TYPE_LABELS[recordTypeFilter] ?? "Record"}
            </button>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {recordError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
              {recordError}
            </div>
          )}

          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setRecordTypeFilter("")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                recordTypeFilter === ""
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              }`}
            >
              All ({records.length})
            </button>
            {CLIENT_RECORD_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRecordTypeFilter(t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  recordTypeFilter === t
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {CLIENT_RECORD_TYPE_PLURALS[t]} ({records.filter((r) => r.type === t).length})
              </button>
            ))}
          </div>

          {showRecordForm && (
            <form
              onSubmit={handleAddRecord}
              className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="mb-2 text-xs font-bold text-slate-900">
                Add {CLIENT_RECORD_TYPE_LABELS[recordTypeFilter] ?? "record"}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Type</label>
                  <select
                    value={recordTypeFilter}
                    onChange={(e) => setRecordTypeFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CLIENT_RECORD_TYPES.map((t) => (
                      <option key={t} value={t}>{CLIENT_RECORD_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Title / Reference *</label>
                  <input
                    value={recordDraft.title}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, title: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Amount (KWD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={recordDraft.amount}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, amount: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Date</label>
                  <input
                    type="date"
                    value={recordDraft.recordDate}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, recordDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Status</label>
                  <select
                    value={recordDraft.status}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CLIENT_RECORD_STATUSES.map((s) => (
                      <option key={s} value={s}>{CLIENT_RECORD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Assigned Person / Reference</label>
                  <input
                    value={recordDraft.assignedTo}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, assignedTo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">Description / Notes</label>
                  <textarea
                    value={recordDraft.description}
                    onChange={(e) => setRecordDraft((p) => ({ ...p, description: e.target.value }))}
                    rows={2}
                    maxLength={2000}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={savingRecord}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingRecord ? "Saving…" : "Save record"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRecordForm(false);
                    setRecordError(null);
                  }}
                  disabled={savingRecord}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {(() => {
            const filtered = recordTypeFilter
              ? records.filter((r) => r.type === recordTypeFilter)
              : records;
            if (filtered.length === 0) {
              return (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-slate-600">
                    {loading ? "Loading records…" : "No records yet."}
                  </p>
                  {!loading && (
                    <p className="mt-1 text-xs text-slate-400">
                      Use Add {CLIENT_RECORD_TYPE_LABELS[recordTypeFilter] ?? "record"} above to create one.
                    </p>
                  )}
                </div>
              );
            }
            return (
              <div className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-start gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{r.title}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            r.status === "paid" || r.status === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : r.status === "overdue" || r.status === "cancelled"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {CLIENT_RECORD_STATUS_LABELS[r.status] ?? r.status}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {CLIENT_RECORD_TYPE_LABELS[r.type] ?? r.type}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {[
                          r.recordDate || null,
                          `${Number(r.amount || 0).toFixed(3)} KWD`,
                          r.assignedTo || null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {r.description && (
                        <div className="mt-0.5 whitespace-pre-line text-[11px] text-slate-600">
                          {r.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRecord(r.id)}
                      disabled={busyRecordId === r.id}
                      className="rounded border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      title="Delete record"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        <h3 className="mt-6 mb-2 text-sm font-bold text-slate-900">Client reports</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-2">
          {reports.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">
                {loading ? "Loading reports…" : "No reports shared yet."}
              </p>
              {!loading && (
                <p className="mt-1 text-xs text-slate-400">
                  Staff uploads against this client land here.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((rep: any) => (
                <button
                  key={rep.id}
                  onClick={() => openReport(rep)}
                  disabled={fetchingUrl === rep.id || !rep.invoice}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-50 disabled:opacity-60"
                  title={rep.invoice ? "Open report" : "No invoice linked"}
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{rep.fileName}</span>
                    <span className="block text-[11px] text-slate-500">
                      {rep.createdAt ? new Date(rep.createdAt).toLocaleDateString() : ""}
                      {rep.invoice ? ` · ${shortInvoiceId(rep.invoice)}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {reportsCapped && (
          <Link
            href={`/admin/clients/${id}/reports`}
            className="mt-2 inline-block text-xs text-blue-600 hover:underline"
          >
            View all reports →
          </Link>
        )}
      </div>
    </AppShell>
  );
}
