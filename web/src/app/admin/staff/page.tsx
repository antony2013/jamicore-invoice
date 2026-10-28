"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";

export default function AdminStaffPage() {
  const router = useRouter();
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
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  async function handleViewAs(staffRow: any) {
    setImpersonatingId(staffRow.id);
    setFormError(null);
    try {
      const res = await fetch(`/api/staff/${staffRow.id}/impersonate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open staff view");
      router.push(data.redirect || "/staff/dashboard");
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setImpersonatingId(null);
    }
  }
  const [staffSearch, setStaffSearch] = useState("");
  const [roleTab, setRoleTab] = useState<"all" | "staff" | "admin">("all");

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

  const staffSummary = (() => {
    const total = staffList.length;
    const active = staffList.filter((s) => (s as any).isActive !== false).length;
    let inProgress = 0;
    let finished = 0;
    for (const s of staffList) {
      const st = stats[s.id];
      if (!st) continue;
      inProgress += st.inProgress ?? 0;
      finished += (st.collected ?? 0) + (st.disputed ?? 0);
    }
    return { total, active, inProgress, finished };
  })();

  const visibleStaff = staffList.filter((s) => {
    if (roleTab !== "all" && s.role !== roleTab) return false;
    const q = staffSearch.trim().toLowerCase();
    if (!q) return true;
    return `${s.name || ""} ${s.email || ""}`.toLowerCase().includes(q);
  });

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total staff</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{loading && staffList.length === 0 ? "…" : staffSummary.total}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active staff</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{loading && staffList.length === 0 ? "…" : staffSummary.active}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Invoices in progress</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{loading && staffList.length === 0 ? "…" : staffSummary.inProgress}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed invoices</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{loading && staffList.length === 0 ? "…" : staffSummary.finished}</div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-1.5">
            {([
              { value: "all", label: "All Accounts" },
              { value: "staff", label: "Staff" },
              { value: "admin", label: "Admin" },
            ] as const).map((o) => (
              <button
                key={o.value}
                onClick={() => setRoleTab(o.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  roleTab === o.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
            placeholder="Search staff name or email…"
            className="flex-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <span className="text-[11px] text-slate-400 whitespace-nowrap">
            {visibleStaff.length} shown of {staffList.length}
          </span>
        </div>
        {success && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
            {success}
          </div>
        )}
        {formError && !showForm && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {formError}
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
        <div className="mb-2">
          <h2 className="text-sm font-bold text-slate-900">Staff List</h2>
          <p className="text-[11px] text-slate-500">Click View Staff Dashboard to open the individual processing queue.</p>
        </div>
        {visibleStaff.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            {loading ? "Loading staff..." : staffList.length === 0 ? "No staff accounts yet." : "No staff match the current search/filter."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visibleStaff.map((s) => {
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
                <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {(s.name || "?").trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {s.name}{" "}
                          {(s as any).isActive === false && (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              inactive
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{s.email}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${s.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-50 text-blue-700"}`}>
                            {s.role}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${online ? "text-emerald-700" : "text-slate-400"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
                            {online ? "Online" : `Offline${ago && ago !== "Never" ? ` · ${ago}` : ""}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-100 bg-white p-2.5">
                      <div className="text-[10px] font-semibold text-slate-500">Assigned</div>
                      <div className="text-xl font-bold text-slate-900">{st.assigned}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2.5">
                      <div className="text-[10px] font-semibold text-amber-700">In Progress</div>
                      <div className="text-xl font-bold text-amber-600">{st.inProgress}</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-2.5">
                      <div className="text-[10px] font-semibold text-blue-700">Verified</div>
                      <div className="text-xl font-bold text-blue-700">{st.verified}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2.5">
                      <div className="text-[10px] font-semibold text-emerald-700">Finished</div>
                      <div className="text-xl font-bold text-emerald-700">{st.collected + st.disputed}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Total invoices <strong className="text-slate-800">{st.total}</strong></span>
                    <span>Clients assigned <strong className="text-slate-800">{st.clients}</strong></span>
                  </div>
                  <button
                    onClick={() => handleViewAs(s)}
                    disabled={impersonatingId === s.id}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold text-center transition disabled:opacity-50"
                    title="Open this staff member's own dashboard directly (no staff login needed)"
                  >
                    {impersonatingId === s.id ? "Opening…" : "View Staff Dashboard »"}
                  </button>
                  <div className="flex items-center gap-1.5">
                    {resettingId === s.id ? (
                      <>
                        <input
                          type="password"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="New password"
                          className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                        />
                        <button
                          onClick={() => handleResetPassword(s.id)}
                          disabled={saving}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setResettingId(null); setResetPassword(""); }}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setResettingId(s.id); setResetPassword(""); setFormError(null); }}
                          className="flex-1 px-2 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                          title="Set a new login password for this staff member"
                        >
                          Reset password
                        </button>
                        <button
                          onClick={() => (lifecycleId === s.id ? (setLifecycleId(null), setLifecycleInfo(null)) : openLifecycle(s))}
                          className="flex-1 px-2 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                          title="Deactivate/reactivate, change role, or reassign open invoices"
                        >
                          Manage
                        </button>
                      </>
                    )}
                  </div>
                  {lifecycleId === s.id && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-3">
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
                          className="px-2 py-1 border border-slate-300 rounded text-xs bg-white outline-none max-w-[180px]"
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
                  )}
                </div>
                  );
                })}
          </div>
        )}
      </AppShell>
  );
}
