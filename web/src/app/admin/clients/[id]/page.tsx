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
  Settings2,
  Store,
} from "lucide-react";
import AppShell from "@/components/AppShell";

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
  const [reportsCapped, setReportsCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState<string | null>(null);
  const [outletName, setOutletName] = useState("");
  const [outletAddress, setOutletAddress] = useState("");
  const [outletPhone, setOutletPhone] = useState("");
  const [outletError, setOutletError] = useState<string | null>(null);
  const [savingOutlet, setSavingOutlet] = useState(false);
  const [busyOutletId, setBusyOutletId] = useState<string | null>(null);
  const [staffMenuOutletId, setStaffMenuOutletId] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [clientRes, outletRes, repRes, staffRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/outlets?clientId=${encodeURIComponent(id)}`),
        fetch(`/api/reports?client=${encodeURIComponent(id)}&limit=50`),
        fetch("/api/staff"),
      ]);
      const clientData = await clientRes.json();
      const outletData = await outletRes.json();
      const repData = await repRes.json();
      const staffData = await staffRes.json();
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
      href: "#assigned-outlets",
      icon: Store,
      title: "Outlets & Staff",
      subtitle: "Add outlets and assign staff",
    },
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

        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                {client ? client.name : loading ? "Loading…" : "Client"}
              </h2>
              <p className="text-xs text-slate-500">Client account overview</p>
            </div>
          </div>
          {client && !client.archivedAt && (
            <span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700">
              Active
            </span>
          )}
          {client?.archivedAt && (
            <span className="rounded bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
              Archived
            </span>
          )}
        </div>

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

        <h3 className="mt-6 mb-2 text-sm font-bold text-slate-900">Client details</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {detailError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
              {detailError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] text-slate-500">User ID</div>
              <div className="font-mono text-xs text-slate-800">{client?.username || "—"}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Phone</div>
              <div className="font-mono text-xs text-slate-800">{client?.phone || "—"}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-[11px] text-slate-500">Email</div>
              <div className="text-xs text-slate-800">{client?.email || "—"}</div>
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
          {outletError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
              {outletError}
            </div>
          )}
          {outlets.length === 0 ? (
            <p className="text-xs text-slate-400">{loading ? "Loading outlets…" : "No outlets assigned yet — add the first one below."}</p>
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
                      <button
                        onClick={() => handleDeleteOutlet(o.id)}
                        disabled={busyOutletId === o.id}
                        className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
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
          <form onSubmit={handleAddOutlet} className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <input
              value={outletName}
              onChange={(e) => setOutletName(e.target.value)}
              placeholder="Outlet name *"
              required
              minLength={2}
              className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={outletAddress}
              onChange={(e) => setOutletAddress(e.target.value)}
              placeholder="Address (optional)"
              className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={outletPhone}
              onChange={(e) => setOutletPhone(e.target.value)}
              placeholder="+18765550123 (optional)"
              className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={savingOutlet}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingOutlet ? "Adding…" : "Add outlet"}
            </button>
          </form>
        </div>

        <h3 className="mt-6 mb-2 text-sm font-bold text-slate-900">Client reports</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-2">
          {reports.length === 0 ? (
            <p className="p-2 text-xs text-slate-400">{loading ? "Loading reports…" : "No reports shared yet."}</p>
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
