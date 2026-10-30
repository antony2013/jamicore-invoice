"use client";
import { shortInvoiceId } from "@/lib/utils";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";

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

  return (
    <AppShell
      role="admin"
      title="Clients"
      subtitle="Manage client accounts, outlets, staff, reports and communications."
      actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm((v) => !v)} className="dc-btn" type="button">
            <UserPlus className="mr-1 inline h-3.5 w-3.5" /> Add Client
          </button>
          <button onClick={load} className="dc-btn" type="button">
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
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
        <div id="client-accounts" className="mb-3">
          <h2 className="text-sm font-bold text-slate-900">Client accounts</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {clients.map((c) => (
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
                <div className="text-[10px] text-slate-400 whitespace-nowrap">
                  Joined {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                </div>
              </div>
              {c.archivedAt && (
                <span className="mt-1 inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                  archived
                </span>
              )}
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
          {clients.length === 0 && !loading && (
            <p className="text-xs text-slate-400">No clients yet.</p>
          )}
        </div>

        {/* Recent activity */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
          <Link href="/admin/audit" className="dc-btn">View audit logs</Link>
        </div>
        <div className="space-y-2 mb-8">
          {activity.length === 0 && (
            <p className="text-xs text-slate-400">{loading ? "Loading activity…" : "No recent activity."}</p>
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
