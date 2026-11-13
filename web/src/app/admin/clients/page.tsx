"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Search, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";
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

export default function AdminClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [businessType, setBusinessType] = useState<string>("company");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [primaryService, setPrimaryService] = useState<string>("administration");
  const [serviceStartDate, setServiceStartDate] = useState("");
  const [clientStatus, setClientStatus] = useState<string>("active");
  const [billingType, setBillingType] = useState<string>("monthly");
  const [baseFee, setBaseFee] = useState("0");
  const [paymentTerms, setPaymentTerms] = useState<string>("10_days_after_approval");
  const [extraWorkAllowed, setExtraWorkAllowed] = useState(true);
  const [internalNotes, setInternalNotes] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Overview (design pattern, existing data only)
  const [allOutlets, setAllOutlets] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [clientRes, outletRes, activityRes] = await Promise.all([
        fetch("/api/clients"),
        fetch("/api/outlets"),
        fetch("/api/history?limit=8"),
      ]);
      const data = await clientRes.json();
      const outletData = await outletRes.json();
      const activityData = await activityRes.json();
      if (data.success) setClients(data.clients);
      if (outletData.success) setAllOutlets(outletData.outlets);
      if (activityData.success) setActivity(activityData.logs);
    } catch (err) {
      console.error("Failed to load clients:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);
    if (!/^[a-z0-9._-]{3,50}$/.test(username.trim().toLowerCase())) {
      setFormError("User ID: 3+ chars, letters/numbers/dots/underscores/hyphens only.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^\+\d{7,15}$/.test(trimmedPhone)) {
      setFormError("Phone must be E.164 format, e.g. +18765550123.");
      return;
    }
    if (!trimmedPhone && !email.trim()) {
      setFormError("Either phone or email is required.");
      return;
    }
    const feeNumber = Number(baseFee);
    if (!Number.isFinite(feeNumber) || feeNumber < 0) {
      setFormError("Base service fee must be a non-negative number.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim().toLowerCase(),
          password,
          ...(trimmedPhone ? { phone: trimmedPhone } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(contactPerson.trim() ? { contactPerson: contactPerson.trim() } : {}),
          businessType,
          ...(registrationNumber.trim() ? { registrationNumber: registrationNumber.trim() } : {}),
          primaryService,
          ...(serviceStartDate ? { serviceStartDate } : {}),
          status: clientStatus,
          billingType,
          baseFee: feeNumber,
          paymentTerms,
          extraWorkAllowed,
          ...(internalNotes.trim() ? { internalNotes: internalNotes.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      setSuccess(`Client "${data.client.name}" created with user ID "${data.client.username}". Share these credentials with the client.`);
      setName("");
      setUsername("");
      setPassword("");
      setPhone("");
      setEmail("");
      setAddress("");
      setContactPerson("");
      setBusinessType("company");
      setRegistrationNumber("");
      setPrimaryService("administration");
      setServiceStartDate("");
      setClientStatus("active");
      setBillingType("monthly");
      setBaseFee("0");
      setPaymentTerms("10_days_after_approval");
      setExtraWorkAllowed(true);
      setInternalNotes("");
      setShowForm(false);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const outletCountByClient: Record<string, number> = {};
  for (const o of allOutlets) {
    if (o.clientId) outletCountByClient[o.clientId] = (outletCountByClient[o.clientId] ?? 0) + 1;
  }

  function timeAgo(value: unknown): string {
    const t = value ? new Date(value as string).getTime() : 0;
    if (!t) return "";
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return new Date(t).toLocaleDateString();
  }

  const query = search.trim().toLowerCase();
  const filteredClients = clients.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (!query) return true;
    return [c.name, c.contactPerson, c.email, c.phone, c.username]
      .filter(Boolean)
      .some((v: string) => String(v).toLowerCase().includes(query));
  });

  const activeCount = clients.filter((c) => c.status === "active").length;
  const inactiveCount = clients.length - activeCount;
  const monthlyFeeTotal = clients
    .filter((c) => c.status === "active" && c.billingType === "monthly")
    .reduce((sum, c) => sum + Number(c.baseFee || 0), 0);

  function exportCsv() {
    const header = [
      "Client",
      "Contact Person",
      "Email",
      "Phone",
      "Business Type",
      "Registration Number",
      "Service",
      "Service Start Date",
      "Status",
      "Billing Type",
      "Base Fee KWD",
      "Payment Terms",
      "Extra Work Allowed",
      "Assigned Staff",
      "User ID",
    ];
    const rows = filteredClients.map((c) => [
      c.name,
      c.contactPerson ?? "",
      c.email ?? "",
      c.phone ?? "",
      BUSINESS_TYPE_LABELS[c.businessType] ?? c.businessType ?? "",
      c.registrationNumber ?? "",
      PRIMARY_SERVICE_LABELS[c.primaryService] ?? c.primaryService ?? "",
      c.serviceStartDate ?? "",
      CLIENT_STATUS_LABELS[c.status] ?? c.status ?? "",
      BILLING_TYPE_LABELS[c.billingType] ?? c.billingType ?? "",
      Number(c.baseFee || 0).toFixed(3),
      PAYMENT_TERMS_LABELS[c.paymentTerms] ?? c.paymentTerms ?? "",
      c.extraWorkAllowed ? "Yes" : "No",
      c.assignedStaffName ?? "Manual",
      c.username ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "client-management.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell
      role="admin"
      title="Clients"
      subtitle="Manage client accounts, outlets, staff, reports and communications."
      actions={
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="dc-btn" type="button" title="Export client list as CSV">
            <Download className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">CSV</span>
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="dc-btn dc-btn-pri" type="button">
            <UserPlus className="mr-1 inline h-3.5 w-3.5" /> Add Client
          </button>
          <button onClick={load} className="dc-btn" type="button" title="Reload clients">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </button>
        </div>
      }
    >
        {success && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
            {success}
          </div>
        )}
        {showForm && (
          <form onSubmit={handleCreate} className="mb-6 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 max-w-xl">
            <h2 className="text-sm font-bold text-slate-900">Add New Client</h2>
            {formError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                {formError}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                placeholder="e.g. Jane Doe"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">User ID (login) *</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="e.g. jane.doe"
                  autoCapitalize="none"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password (min 8) *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone (E.164)</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+18765550123"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Street, area, city, postal code"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-xs font-bold text-slate-900 mb-3">Service &amp; assignment</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
                  <input
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    placeholder="Contact person"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Business Type</label>
                  <select
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {BUSINESS_TYPES.map((v) => (
                      <option key={v} value={v}>{BUSINESS_TYPE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Registration Number</label>
                  <input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Service</label>
                  <select
                    value={primaryService}
                    onChange={(e) => setPrimaryService(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PRIMARY_SERVICES.map((v) => (
                      <option key={v} value={v}>{PRIMARY_SERVICE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Service Start Date</label>
                  <input
                    type="date"
                    value={serviceStartDate}
                    onChange={(e) => setServiceStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Client Status</label>
                  <select
                    value={clientStatus}
                    onChange={(e) => setClientStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CLIENT_STATUSES.map((v) => (
                      <option key={v} value={v}>{CLIENT_STATUS_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-xs font-bold text-slate-900 mb-3">Billing configuration</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Type</label>
                  <select
                    value={billingType}
                    onChange={(e) => setBillingType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {BILLING_TYPES.map((v) => (
                      <option key={v} value={v}>{BILLING_TYPE_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base Service Fee (KWD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={baseFee}
                    onChange={(e) => setBaseFee(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Terms</label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PAYMENT_TERMS.map((v) => (
                      <option key={v} value={v}>{PAYMENT_TERMS_LABELS[v]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Extra Work Charges Allowed</label>
                  <select
                    value={extraWorkAllowed ? "yes" : "no"}
                    onChange={(e) => setExtraWorkAllowed(e.target.value === "yes")}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Internal Notes</label>
                  <input
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    maxLength={2000}
                    placeholder="Optional notes (admin only)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">The client signs into the mobile app with this user ID + password. Share them securely.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 px-4 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create Client"}
              </button>
            </div>
          </form>
        )}

        {/* Client accounts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] text-slate-500">Total Clients</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{clients.length}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] text-slate-500">Active Clients</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{activeCount}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] text-slate-500">Inactive Clients</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{inactiveCount}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] text-slate-500">Monthly Service Fees</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{monthlyFeeTotal.toFixed(3)}</div>
            <div className="text-[11px] text-slate-400">KWD</div>
          </div>
        </div>

        <div id="client-accounts" className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Client accounts</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone…"
                className="w-56 rounded-lg border border-slate-300 py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Status</option>
              {CLIENT_STATUSES.map((v) => (
                <option key={v} value={v}>{CLIENT_STATUS_LABELS[v]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {filteredClients.map((c) => (
            <div
              key={c.id}
              onClick={() => router.push(`/admin/clients/${c.id}`)}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:shadow-md transition"
              title="Open client workspace"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="text-sm font-bold text-blue-700 hover:underline"
                  title="Open client workspace"
                >
                  {c.name}
                </Link>
                <div className="text-[11px] text-slate-400 whitespace-nowrap">
                  Joined {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-block text-[11px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    c.status === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : c.status === "suspended"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {CLIENT_STATUS_LABELS[c.status] ?? c.status ?? "active"}
                </span>
                {c.archivedAt && (
                  <span className="inline-block text-[11px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                    archived
                  </span>
                )}
                {c.primaryService && (
                  <span className="text-[11px] text-slate-500">
                    {PRIMARY_SERVICE_LABELS[c.primaryService] ?? c.primaryService}
                  </span>
                )}
                {c.billingType === "monthly" && (
                  <span className="text-[11px] text-slate-500">
                    · {Number(c.baseFee || 0).toFixed(3)} KWD/mo
                  </span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                <span>Outlets: <strong>{outletCountByClient[c.id] ?? 0}</strong></span>
                <span>Staff: <strong>{c.assignedStaffName || "Manual"}</strong></span>
                <span>Invoices: <strong>{c.totalInvoices}</strong></span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-mono">
                User ID: {c.username || "—"}
              </div>
              {[c.phone, c.email].filter(Boolean).length > 0 && (
                <div className="text-[11px] text-slate-500">
                  {[c.phone, c.email].filter(Boolean).join(" · ")}
                </div>
              )}
              {c.address && (
                <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                  {c.address}
                </div>
              )}
            </div>
          ))}
          {filteredClients.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">
                {clients.length === 0 ? "No clients yet." : "No clients match this search or filter."}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {clients.length === 0
                  ? "Add the first client above, then invite them to upload invoices."
                  : "Clear the search or choose All Status to see every client."}
              </p>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
          <Link href="/admin/audit" className="dc-btn">View audit logs</Link>
        </div>
        <div className="space-y-2 mb-8">
          {activity.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">
                {loading ? "Loading activity…" : "No recent activity."}
              </p>
              {!loading && (
                <p className="mt-1 text-xs text-slate-400">
                  Invoice and client changes show up here as they happen.
                </p>
              )}
            </div>
          )}
          {activity.map((log) => (
            <div key={log.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-xs">
              <div className="font-bold text-slate-800 capitalize">
                {String(log.status).replace(/_/g, " ")}
              </div>
              <div className="text-slate-500 mt-0.5">
                {log.actor ? `${log.actor.name} (${log.actor.role})` : "Automated system"}
                {log.invoice ? ` · ${log.invoice.clientName} · ` : " · "}
                {log.invoice ? (
                  <Link href={`/admin/invoices/${log.invoice.id}`} className="text-blue-600 hover:underline font-mono">
                    {shortInvoiceId(log.invoice)}
                  </Link>
                ) : null}
                {log.timestamp ? ` · ${timeAgo(log.timestamp)}` : ""}
              </div>
              {log.note && <div className="text-slate-600 mt-0.5">{log.note}</div>}
            </div>
          ))}
        </div>
      </AppShell>
  );
}
