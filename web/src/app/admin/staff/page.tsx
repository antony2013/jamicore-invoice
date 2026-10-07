"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, UserPlus, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";

export default function AdminStaffPage() {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, { assigned: number; inProgress: number; verified: number; collected: number; disputed: number; total: number; clients: number }>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Per-row password reset (admin sets a new login password for the member)
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  // Lifecycle panel per row: active toggle (confirm shows open work),
  // role change, and bulk-reassign of open invoices to another staffer.
  const [lifecycleId, setLifecycleId] = useState<string | null>(null);
  const [lifecycleInfo, setLifecycleInfo] = useState<{ openInvoiceCount: number } | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [staffRes, statsRes] = await Promise.all([
        fetch("/api/staff"),
        fetch("/api/staff/stats"),
      ]);
      const staffData = await staffRes.json();
      const statsData = await statsRes.json();
      if (staffData.success) setStaffList(staffData.staff);
      if (statsData.success) setStats(statsData.stats);
    } catch (err) {
      console.error("Failed to load staff:", err);
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
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create staff member");
      setSuccess(`${data.staff.name} (${data.staff.role}) created — they can now sign in.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("staff");
      setShowForm(false);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      role="admin"
      title="Staff Management"
      subtitle="Review queues, presence, and lifecycle controls."
      actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm((v) => !v)} className="dc-btn" type="button">
            <UserPlus className="mr-1 inline h-3.5 w-3.5" /> Add Staff
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
            <h2 className="text-sm font-bold text-slate-900">Add Staff / Admin Account</h2>
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
                placeholder="e.g. Operations Staff"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Work Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="staff@jamicore.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password (min 8 chars) *</label>
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
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 outline-none"
                >
                  <option value="staff">Staff (verify invoices)</option>
                  <option value="admin">Admin (full access)</option>
                </select>
              </div>
            </div>
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
                {saving ? "Creating…" : "Create Account"}
              </button>
            </div>
          </form>
        )}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Name</th>
                <th className="px-6 py-3.5">Email</th>
                <th className="px-6 py-3.5">Role</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-center" title="Assigned, waiting to start">Assigned</th>
                <th className="px-6 py-3.5 text-center" title="In review / needs info">In Progress</th>
                <th className="px-6 py-3.5 text-center" title="Verified, ready for collection">Verified</th>
                <th className="px-6 py-3.5 text-center" title="Collected — finished">Finished ✅</th>
                <th className="px-6 py-3.5 text-center">Total</th>
                <th className="px-6 py-3.5 text-center" title="Distinct clients currently assigned">Clients</th>
                <th className="px-6 py-3.5">Joined</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-slate-400">
                    {loading ? "Loading staff..." : "No staff accounts yet."}
                  </td>
                </tr>
              ) : (
                staffList.map((s) => {
                  const st = stats[s.id] || { assigned: 0, inProgress: 0, verified: 0, collected: 0, disputed: 0, total: 0, clients: 0 };
                  const lastSeen = (s as any).lastSeenAt ? new Date((s as any).lastSeenAt).getTime() : 0;
                  const online = Date.now() - lastSeen < 5 * 60 * 1000;
                  const ago = !(s as any).lastSeenAt
                    ? "Never"
                    : online
                      ? "now"
                      : (() => {
                          const m = Math.floor((Date.now() - lastSeen) / 60000);
                          return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
                        })();
  async function handleResetPassword(staffId: string) {
    if (resetPassword.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setResettingId(null);
      setResetPassword("");
      setSuccess("Password reset. Share the new password with the staff member.");
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openLifecycle(staffRow: any) {
    setLifecycleId(staffRow.id);
    setLifecycleInfo(null);
    setLifecycleTarget("");
    setFormError(null);
    try {
      const res = await fetch(`/api/staff/${staffRow.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load staff details");
      setLifecycleInfo({ openInvoiceCount: data.openInvoiceCount ?? 0 });
    } catch (err: any) {
      setFormError(err.message);
    }
  }

  async function handleToggleActive(staffRow: any) {
    setLifecycleBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/staff/${staffRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !(staffRow.isActive ?? true) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setSuccess(data.message);
      setLifecycleId(null);
      setLifecycleInfo(null);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleRoleChange(staffRow: any, role: string) {
    if (role === staffRow.role) return;
    setLifecycleBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/staff/${staffRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change role");
      setSuccess(data.message);
      setLifecycleId(null);
      setLifecycleInfo(null);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleReassignOpen(staffRow: any) {
    if (!lifecycleTarget) {
      setFormError("Pick a target staff member first.");
      return;
    }
    setLifecycleBusy(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/staff/${staffRow.id}/reassign-open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStaffId: lifecycleTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reassign");
      setSuccess(data.message);
      setLifecycleId(null);
      setLifecycleInfo(null);
      setLifecycleTarget("");
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
                <Fragment key={s.id}>
                  <tr className="hover:bg-slate-50/80">
                    <td className="px-6 py-4 font-medium text-slate-800">
                      {s.name}{" "}
                      {(s as any).isActive === false && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">{s.email}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${s.role === "admin" ? "bg-slate-900 text-white" : "bg-blue-50 text-blue-700"}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${online ? "text-emerald-700" : "text-slate-400"}`}>
                        <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
                        {online ? "Online" : `Offline · ${ago}`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-purple-700">{st.assigned}</td>
                    <td className="px-6 py-4 text-center font-bold text-amber-600">{st.inProgress}</td>
                    <td className="px-6 py-4 text-center font-bold text-blue-700">{st.verified}</td>
                    <td className="px-6 py-4 text-center font-bold text-emerald-700">{st.collected}</td>
                    <td className="px-6 py-4 text-center font-bold text-slate-800">{st.total}</td>
                    <td className="px-6 py-4 text-center font-bold text-slate-600">{st.clients}</td>
                    <td className="px-6 py-4">{new Date(s.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                      {resettingId === s.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="password"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            placeholder="New password"
                            className="w-32 px-2 py-1 border border-slate-300 rounded text-xs outline-none"
                          />
                          <button
                            onClick={() => handleResetPassword(s.id)}
                            disabled={saving}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setResettingId(null); setResetPassword(""); }}
                            className="px-2 py-1 border border-slate-200 rounded text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setResettingId(s.id); setResetPassword(""); setFormError(null); }}
                          className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium"
                          title="Set a new login password for this staff member"
                        >
                          Reset password
                        </button>
                      )}
                        <button
                          onClick={() => (lifecycleId === s.id ? (setLifecycleId(null), setLifecycleInfo(null)) : openLifecycle(s))}
                          className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium"
                          title="Deactivate/reactivate, change role, or reassign open invoices"
                        >
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                  {lifecycleId === s.id && (
                    <tr key={`${s.id}-lifecycle`} className="bg-slate-50/70">
                      <td colSpan={12} className="px-6 py-4">
                        <div className="max-w-2xl space-y-3">
                          <h4 className="text-xs font-bold text-slate-800">
                            Manage {s.name} ({s.email})
                          </h4>
                          <p className="text-xs text-slate-500">
                            Open invoices with this person:{" "}
                            <strong>{lifecycleInfo ? lifecycleInfo.openInvoiceCount : "…"}</strong>{" "}
                            (assigned / in review / info needed). Deactivating strands them unless reassigned first.
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${(s as any).isActive === false ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {(s as any).isActive === false ? "Inactive" : "Active"}
                            </span>
                            <button
                              onClick={() => handleToggleActive(s)}
                              disabled={lifecycleBusy}
                              className="px-2.5 py-1 border border-amber-300 hover:bg-amber-50 text-amber-700 rounded text-xs font-medium disabled:opacity-50"
                            >
                              {(s as any).isActive === false ? "Reactivate" : "Deactivate"}
                            </button>
                            <select
                              value={s.role}
                              onChange={(e) => handleRoleChange(s, e.target.value)}
                              disabled={lifecycleBusy}
                              className="px-2 py-1 border border-slate-300 rounded text-xs bg-white outline-none"
                              title="Change role"
                            >
                              <option value="staff">staff</option>
                              <option value="admin">admin</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-600">Move open invoices to:</span>
                            <select
                              value={lifecycleTarget}
                              onChange={(e) => setLifecycleTarget(e.target.value)}
                              className="px-2 py-1 border border-slate-300 rounded text-xs bg-white outline-none max-w-[220px]"
                            >
                              <option value="">Pick staff…</option>
                              {staffList
                                .filter((t: any) => t.id !== s.id && t.role === "staff" && (t as any).isActive !== false)
                                .map((t: any) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.email})
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={() => handleReassignOpen(s)}
                              disabled={lifecycleBusy || !lifecycleTarget}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium disabled:opacity-50"
                            >
                              Reassign open
                            </button>
                            <button
                              onClick={() => { setLifecycleId(null); setLifecycleInfo(null); }}
                              className="px-2.5 py-1 border border-slate-200 rounded text-xs bg-white"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
  );
}
