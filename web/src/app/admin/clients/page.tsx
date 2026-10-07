"use client";

import { useEffect, useState, Fragment } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Users, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";

export default function AdminClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  // Two-step client removal: step 1 (Remove click) fetches destroy counts,
  // step 2 requires typing the client's user ID exactly.
  const [removing, setRemoving] = useState<any | null>(null);
  const [removeCounts, setRemoveCounts] = useState<{ invoices: number; outlets: number; members: number } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  // Outlets per client
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [outletsByClient, setOutletsByClient] = useState<Record<string, any[]>>({});
  const [outletName, setOutletName] = useState("");
  const [outletAddress, setOutletAddress] = useState("");
  const [outletPhone, setOutletPhone] = useState("");
  const [outletError, setOutletError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [clientRes, staffRes] = await Promise.all([
        fetch("/api/clients"),
        fetch("/api/staff"),
      ]);
      const data = await clientRes.json();
      const staffData = await staffRes.json();
      if (data.success) setClients(data.clients);
      if (staffData.success) {
        setStaffList(staffData.staff.filter((s: any) => s.role === "staff"));
      }
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
      setShowForm(false);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(clientId: string) {
    if (resetPassword.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setSuccess(`Password reset. Share the new password with the client.`);
      setResettingId(null);
      setResetPassword("");
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleOutlets(clientId: string) {
    if (expandedClient === clientId) {
      setExpandedClient(null);
      return;
    }
    setExpandedClient(clientId);
    setOutletError(null);
    setOutletName("");
    setOutletAddress("");
    setOutletPhone("");
    try {
      const res = await fetch(`/api/outlets?clientId=${clientId}`);
      const data = await res.json();
      if (data.success) {
        setOutletsByClient((prev) => ({ ...prev, [clientId]: data.outlets }));
      }
    } catch (err) {
      console.error("Failed to load outlets:", err);
    }
  }

  async function handleAddOutlet(e: React.FormEvent, clientId: string) {
    e.preventDefault();
    setOutletError(null);
    setSuccess(null);
    if (outletName.trim().length < 2) {
      setOutletError("Outlet name must be at least 2 characters.");
      return;
    }
    const ph = outletPhone.trim();
    if (ph && !/^\+\d{7,15}$/.test(ph)) {
      setOutletError("Outlet phone must be E.164 format, e.g. +18765550123.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/outlets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: outletName.trim(),
          ...(outletAddress.trim() ? { address: outletAddress.trim() } : {}),
          ...(ph ? { phone: ph } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create outlet");
      setOutletsByClient((prev) => ({ ...prev, [clientId]: [...(prev[clientId] || []), data.outlet] }));
      setOutletName("");
      setOutletAddress("");
      setOutletPhone("");
      setSuccess(`Outlet "${data.outlet.name}" added.`);
    } catch (err: any) {
      setOutletError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleOutletStaff(clientId: string, outletId: string, staffId: string) {
    setOutletError(null);
    try {
      const res = await fetch(`/api/outlets/${outletId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedStaffId: staffId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set outlet staff");
      setOutletsByClient((prev) => ({
        ...prev,
        [clientId]: (prev[clientId] || []).map((o) =>
          o.id === outletId
            ? {
                ...o,
                assignedStaffId: staffId || null,
                assignedStaffName: staffId
                  ? staffList.find((s) => s.id === staffId)?.name || null
                  : null,
              }
            : o
        ),
      }));
      setSuccess(
        staffId
          ? `Uploads tagged "${data.outlet.name}" now route to ${staffList.find((s) => s.id === staffId)?.name} (+ existing backlog swept).`
          : `Outlet "${data.outlet.name}" falls back to client default/manual.`
      );
    } catch (err: any) {
      setOutletError(err.message);
    }
  }

  async function handleDeleteOutlet(clientId: string, outletId: string) {    if (!confirm("Delete this outlet? Invoices must be unlinked first.")) return;
    setOutletError(null);
    try {
      const res = await fetch(`/api/outlets/${outletId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete outlet");
      setOutletsByClient((prev) => ({
        ...prev,
        [clientId]: (prev[clientId] || []).filter((o) => o.id !== outletId),
      }));
    } catch (err: any) {
      setOutletError(err.message);
    }
  }

  async function handleDefaultStaff(clientId: string, staffId: string) {
    setFormError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedStaffId: staffId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set default staff");
      setClients((prev) =>
        prev.map((c) =>
          c.id === clientId
            ? {
                ...c,
                assignedStaffId: staffId || null,
                assignedStaffName: staffId
                  ? staffList.find((s) => s.id === staffId)?.name || null
                  : null,
              }
            : c
        )
      );
      setSuccess(
        staffId
          ? `All invoices of this client will route to ${staffList.find((s) => s.id === staffId)?.name}.`
          : "Default staff cleared — invoices need manual assignment."
      );
    } catch (err: any) {
      setFormError(err.message);
    }
  }

  // Step 1 of removal: ask the server what would be destroyed (nothing is
  // deleted yet) and open the confirm panel for this client.
  async function handleRemoveStep1(client: any) {
    setRemoveError(null);
    setRemoveConfirm("");
    setRemovingBusy(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) throw new Error("Unexpected success without confirmation");
      if (!data.counts) throw new Error(data.error || "Failed to start removal");
      setRemoving(client);
      setRemoveCounts(data.counts);
    } catch (err: any) {
      setRemoveError(err.message);
    } finally {
      setRemovingBusy(false);
    }
  }

  // Step 2: typed user ID matches → delete (zero-invoice clients only;
  // the server 409s anything with history and tells you to archive).
  async function handleRemoveStep2() {
    if (!removing) return;
    setRemoveError(null);
    setRemovingBusy(true);
    try {
      const res = await fetch(`/api/clients/${removing.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmUsername: removeConfirm.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete client");
      setRemoving(null);
      setRemoveCounts(null);
      setRemoveConfirm("");
      setSuccess(data.message);
      load();
    } catch (err: any) {
      setRemoveError(err.message);
    } finally {
      setRemovingBusy(false);
    }
  }

  // Archive / unarchive: keeps history, blocks login, kills tokens.
  async function handleArchive(client: any, to: boolean) {
    setRemovingBusy(true);
    setRemoveError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update archive state");
      setRemoving(null);
      setRemoveCounts(null);
      setSuccess(
        to
          ? `Client "${client.name}" archived — login blocked, existing tokens revoked. History is preserved.`
          : `Client "${client.name}" unarchived — login restored.`
      );
      load();
    } catch (err: any) {
      setRemoveError(err.message);
    } finally {
      setRemovingBusy(false);
    }
  }

  function cancelRemove() {
    setRemoving(null);
    setRemoveCounts(null);
    setRemoveConfirm("");
    setRemoveError(null);
  }

  return (
    <AppShell
      role="admin"
      title="Clients"
      subtitle="Client accounts, outlets, default staff routing, and removal."
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Name</th>
                <th className="px-6 py-3.5">User ID</th>
                <th className="px-6 py-3.5">Phone</th>
                <th className="px-6 py-3.5">Email</th>
                <th className="px-6 py-3.5">Outlets</th>
                <th className="px-6 py-3.5" title="All invoices of this client route here">Default Staff</th>
                <th className="px-6 py-3.5">Invoices</th>
                <th className="px-6 py-3.5">Joined</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    {loading ? "Loading clients..." : "No clients yet."}
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="hover:bg-slate-50/80">
                      <td className="px-6 py-4 font-medium text-slate-800">
                        {c.name}{" "}
                        {c.archivedAt && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                            archived
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono">{c.username || <span className="text-amber-600">no login — reset below</span>}</td>
                      <td className="px-6 py-4 font-mono">{c.phone || "—"}</td>
                      <td className="px-6 py-4">{c.email || "—"}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleOutlets(c.id)}
                          className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-xs font-semibold"
                          title="Manage this client's outlets/shops"
                        >
                          {(outletsByClient[c.id]?.length ?? "…")} outlets {expandedClient === c.id ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={c.assignedStaffId || ""}
                          onChange={(e) => handleDefaultStaff(c.id, e.target.value)}
                          className="px-2 py-1 border border-slate-300 rounded text-xs bg-slate-50 outline-none max-w-[150px]"
                          title="Every invoice of this client routes to this staff member"
                        >
                          <option value="">Manual…</option>
                          {staffList.filter((s) => s.role === "staff").map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4">{c.totalInvoices}</td>
                      <td className="px-6 py-4">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                      {resettingId === c.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="password"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            placeholder="New password"
                            className="w-32 px-2 py-1 border border-slate-300 rounded text-xs outline-none"
                          />
                          <button
                            onClick={() => handleResetPassword(c.id)}
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
                          onClick={() => { setResettingId(c.id); setResetPassword(""); setFormError(null); }}
                          className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium"
                          title="Set a new login password for this client"
                        >
                          Reset password
                        </button>
                      )}
                        <button
                          onClick={() => handleRemoveStep1(c)}
                          disabled={removingBusy}
                          className="px-2.5 py-1 border border-red-200 hover:bg-red-50 text-red-600 rounded text-xs font-medium disabled:opacity-50"
                          title="Archive, or permanently remove when the client has zero invoices (two-step verify)"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => handleArchive(c, !c.archivedAt)}
                          disabled={removingBusy}
                          className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium disabled:opacity-50"
                          title={c.archivedAt ? "Restore login for this client" : "Archive: block login, revoke tokens, keep history"}
                        >
                          {c.archivedAt ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {removing?.id === c.id && (
                    <tr key={`${c.id}-remove`} className="bg-red-50/60">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="max-w-2xl">
                          <h4 className="text-xs font-bold text-red-800 mb-1">
                            Remove “{c.name}” (@{c.username || c.name}) permanently?
                          </h4>
                          {removeError && (
                            <div className="mb-2 p-2 rounded-lg bg-white border border-red-300 text-red-700 text-xs">
                              {removeError}
                            </div>
                          )}
                          {(removeCounts?.invoices ?? 0) > 0 ? (
                            <>
                              <p className="text-xs text-red-700 mb-2">
                                This client has {removeCounts?.invoices} invoice(s) — history is
                                preserved even for withdrawn ones, so hard delete is blocked.{" "}
                                Archive instead: login is blocked, tokens die, everything stays.
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleArchive(c, true)}
                                  disabled={removingBusy}
                                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold disabled:opacity-50"
                                >
                                  {removingBusy ? "Working…" : "Archive instead"}
                                </button>
                                <button
                                  onClick={cancelRemove}
                                  className="px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-red-700 mb-2">
                                Zero invoices — this destroys {removeCounts?.outlets ?? "…"} outlet(s)
                                and {removeCounts?.members ?? "…"} team member(s). This cannot be undone.
                              </p>
                          <div className="flex items-center gap-2">
                            <input
                              value={removeConfirm}
                              onChange={(e) => setRemoveConfirm(e.target.value)}
                              placeholder={`Type ${c.username || c.name} to confirm`}
                              autoCapitalize="none"
                              autoCorrect="off"
                              className="flex-1 px-2 py-1.5 border border-red-300 rounded text-xs outline-none font-mono"
                            />
                            <button
                              onClick={handleRemoveStep2}
                              disabled={removingBusy || !removeConfirm.trim() || removeConfirm.trim() !== (c.username || c.name)}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold disabled:opacity-40"
                            >
                              {removingBusy ? "Removing…" : "Confirm delete"}
                            </button>
                            <button
                              onClick={cancelRemove}
                              className="px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                            >
                              Cancel
                            </button>
                          </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {expandedClient === c.id && (
                    <tr key={`${c.id}-outlets`} className="bg-purple-50/50">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="max-w-2xl">
                          <h4 className="text-xs font-bold text-slate-800 mb-2">
                            Outlets / Shops of {c.name}
                          </h4>
                          {outletError && (
                            <div className="mb-2 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                              {outletError}
                            </div>
                          )}
                          {(outletsByClient[c.id] || []).length === 0 ? (
                            <p className="text-xs text-slate-400 mb-3">No outlets yet — add the first shop below.</p>
                          ) : (
                            <div className="space-y-2 mb-3">
                              {(outletsByClient[c.id] || []).map((o) => (
                                <div key={o.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 gap-2">
                                  <div className="flex-1">
                                    <div className="text-xs font-bold text-slate-800">{o.name}</div>
                                    <div className="text-[11px] text-slate-500">
                                      {[o.address, o.phone].filter(Boolean).join(" • ") || "—"}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      Added by {o.createdByName || "office"}
                                    </div>
                                  </div>
                                  <select
                                    value={o.assignedStaffId || ""}
                                    onChange={(e) => handleOutletStaff(c.id, o.id, e.target.value)}
                                    className="px-2 py-1 border border-slate-300 rounded text-xs bg-purple-50 outline-none max-w-[130px]"
                                    title="Default staff for this outlet (overrides client default on tagged uploads)"
                                  >
                                    <option value="">Staff…</option>
                                    {staffList.filter((s) => s.role === "staff").map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleDeleteOutlet(c.id, o.id)}
                                    className="px-2 py-1 text-red-600 hover:bg-red-50 border border-red-200 rounded text-xs font-medium"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <form onSubmit={(e) => handleAddOutlet(e, c.id)} className="flex flex-wrap gap-2">
                            <input
                              value={outletName}
                              onChange={(e) => setOutletName(e.target.value)}
                              placeholder="Shop name *"
                              required
                              minLength={2}
                              className="flex-1 min-w-[140px] px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                            />
                            <input
                              value={outletAddress}
                              onChange={(e) => setOutletAddress(e.target.value)}
                              placeholder="Address (optional)"
                              className="flex-1 min-w-[140px] px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs outline-none"
                            />
                            <input
                              value={outletPhone}
                              onChange={(e) => setOutletPhone(e.target.value)}
                              placeholder="+18765550123 (optional)"
                              className="w-44 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs outline-none font-mono"
                            />
                            <button
                              type="submit"
                              disabled={saving}
                              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                            >
                              {saving ? "Adding…" : "Add Outlet"}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
  );
}
