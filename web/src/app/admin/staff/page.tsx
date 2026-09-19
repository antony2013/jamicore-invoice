"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, UserPlus, ShieldCheck } from "lucide-react";

export default function AdminStaffPage() {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, { assigned: number; inProgress: number; verified: number; collected: number; disputed: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Staff Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Queue
            </Link>
            <Link href="/admin/clients" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              Manage Clients
            </Link>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Staff
            </button>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Name</th>
                <th className="px-6 py-3.5">Email</th>
                <th className="px-6 py-3.5">Role</th>
                <th className="px-6 py-3.5 text-center" title="Assigned, waiting to start">Assigned</th>
                <th className="px-6 py-3.5 text-center" title="In review / needs info">In Progress</th>
                <th className="px-6 py-3.5 text-center" title="Verified, ready for collection">Verified</th>
                <th className="px-6 py-3.5 text-center" title="Collected — finished">Finished ✅</th>
                <th className="px-6 py-3.5 text-center">Total</th>
                <th className="px-6 py-3.5">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    {loading ? "Loading staff..." : "No staff accounts yet."}
                  </td>
                </tr>
              ) : (
                staffList.map((s) => {
                  const st = stats[s.id] || { assigned: 0, inProgress: 0, verified: 0, collected: 0, disputed: 0, total: 0 };
                  return (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-4 font-medium text-slate-800">{s.name}</td>
                    <td className="px-6 py-4">{s.email}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${s.role === "admin" ? "bg-slate-900 text-white" : "bg-blue-50 text-blue-700"}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-purple-700">{st.assigned}</td>
                    <td className="px-6 py-4 text-center font-bold text-amber-600">{st.inProgress}</td>
                    <td className="px-6 py-4 text-center font-bold text-blue-700">{st.verified}</td>
                    <td className="px-6 py-4 text-center font-bold text-emerald-700">{st.collected}</td>
                    <td className="px-6 py-4 text-center font-bold text-slate-800">{st.total}</td>
                    <td className="px-6 py-4">{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
