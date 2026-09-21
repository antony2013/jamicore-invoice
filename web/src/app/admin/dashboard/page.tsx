"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCheck,
  Filter,
  ArrowRight,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { signOut } from "next-auth/react";

export default function AdminDashboard() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [outletFilter, setOutletFilter] = useState<string>("all");
  const [outletList, setOutletList] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStaffId, setBulkStaffId] = useState<string>("");
  const [bulkPriority, setBulkPriority] = useState<string>("normal");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [assignPriority, setAssignPriority] = useState<string>("normal");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (outletFilter !== "all") params.set("outlet", outletFilter);
      if (staffFilter !== "all" && staffFilter !== "unassigned") params.set("assigned_to", staffFilter);
      const qs = params.toString();
      const url = qs ? `/api/invoices?${qs}` : "/api/invoices";
      const [invRes, staffRes, outletRes] = await Promise.all([
        fetch(url),
        fetch("/api/staff"),
        fetch("/api/outlets"),
      ]);

      const invData = await invRes.json();
      const staffData = await staffRes.json();
      const outletData = await outletRes.json();

      if (invData.success) {
        setInvoices(invData.invoices);
        setSelectedIds([]);
      }
      if (staffData.success) setStaffList(staffData.staff);
      if (outletData.success) setOutletList(outletData.outlets);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, outletFilter, staffFilter]);

  // Client-side visible rows: search + unassigned + priority
  const visibleInvoices = invoices.filter((inv) => {
    if (staffFilter === "unassigned" && inv.assignedTo) return false;
    if (priorityFilter !== "all" && inv.priority !== priorityFilter) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = [
        inv.id,
        inv.s3Key,
        inv.client?.name,
        inv.client?.phone,
        inv.client?.email,
        inv.outlet?.name,
        inv.ocrData?.vendor,
        inv.ocrData?.invoiceNo,
        inv.ocrData?.amount != null ? String(inv.ocrData.amount) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectVisible() {
    const ids = visibleInvoices.map((i) => i.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : ids);
  }

  async function handleBulkAssign() {
    if (selectedIds.length === 0 || !bulkStaffId) return;
    setAssigning(true);
    setAssignError(null);
    setSuccessMessage(null);
    let ok = 0;
    const failed: string[] = [];
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/invoices/${id}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: bulkStaffId, priority: bulkPriority }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed");
        ok++;
      } catch (err: any) {
        failed.push(`${id.substring(0, 8)}: ${err.message}`);
      }
    }
    setSuccessMessage(
      failed.length === 0
        ? `${ok} invoice(s) assigned.`
        : `${ok} assigned, ${failed.length} failed (${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "…" : ""})`
    );
    setSelectedIds([]);
    loadData();
    setAssigning(false);
  }

  function handleExportCsv() {
    const header = ["id", "client", "phone", "outlet", "status", "priority", "amount", "vendor", "invoiceNo", "assignedTo", "createdAt"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const inv of visibleInvoices) {
      lines.push(
        [
          inv.id,
          inv.client?.name,
          inv.client?.phone || inv.client?.email,
          inv.outlet?.name,
          inv.status,
          inv.priority,
          inv.ocrData?.amount,
          inv.ocrData?.vendor,
          inv.ocrData?.invoiceNo,
          inv.assignedStaff?.name,
          inv.createdAt,
        ]
          .map(esc)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInvoice || !selectedStaffId) return;

    setAssigning(true);
    setAssignError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/invoices/${selectedInvoice.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: selectedStaffId,
          priority: assignPriority,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assignment failed");

      setSuccessMessage("Invoice successfully assigned!");
      setSelectedInvoice(null);
      loadData();
    } catch (err: any) {
      setAssignError(err.message);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="JamiCore"
              className="h-10 w-auto rounded-lg bg-white border border-slate-200 px-2 py-1 object-contain"
            />
            <span className="p-2 bg-slate-900 text-white rounded-lg font-bold text-sm">
              ADMIN
            </span>
            <h1 className="text-lg font-bold text-slate-900">Invoice Operations Center</h1>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/admin/clients"
              className="text-xs text-slate-600 hover:text-slate-900 font-medium"
            >
              Clients
            </Link>
            <Link
              href="/admin/staff"
              className="text-xs text-slate-600 hover:text-slate-900 font-medium"
            >
              Staff
            </Link>
            <Link
              href="/admin/history"
              className="text-xs text-slate-600 hover:text-slate-900 font-medium"
            >
              History
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Log out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Highlights */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Unassigned Queue</div>
            <div className="text-2xl font-bold text-slate-900 mt-2">
              {invoices.filter((i) => !i.assignedTo && ["uploaded", "ocr_done", "ocr_failed"].includes(i.status)).length}
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">New Uploads</div>
            <div className="text-2xl font-bold text-blue-600 mt-2">
              {invoices.filter((i) => i.status === "uploaded").length}
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">In Review</div>
            <div className="text-2xl font-bold text-amber-600 mt-2">
              {invoices.filter((i) => ["assigned", "in_review", "needs_info"].includes(i.status)).length}
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Collected</div>
            <div className="text-2xl font-bold text-emerald-600 mt-2">
              {invoices.filter((i) => i.status === "collected").length}
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-700">Filter Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none"
            >
              <option value="all">All Invoices</option>
              <option value="uploaded">Uploaded</option>
              
              <option value="ocr_done">OCR Done (legacy)</option>
              <option value="ocr_failed">OCR Failed (legacy)</option>
              <option value="assigned">Assigned</option>
              <option value="in_review">In Review</option>
              <option value="needs_info">Needs Info</option>
              <option value="verified">Verified</option>
              <option value="collected">Collected</option>
              <option value="disputed">Disputed</option>
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-700">Outlet:</span>
            <select
              value={outletFilter}
              onChange={(e) => setOutletFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none max-w-[220px]"
            >
              <option value="all">All Outlets</option>
              {outletList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.clientName} — {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-700">Staff:</span>
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none max-w-[180px]"
            >
              <option value="all">All Staff</option>
              <option value="unassigned">Unassigned</option>
              {staffList.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-700">Priority:</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none"
            >
              <option value="all">All</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <button
            onClick={() => loadData()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh Queue
          </button>
        </div>

        {/* Search + Export Toolbar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 flex flex-col sm:flex-row items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, phone, vendor, invoice no, ID…"
            className="flex-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 text-slate-800 outline-none"
          />
          <span className="text-[11px] text-slate-400 whitespace-nowrap">
            {visibleInvoices.length} shown
          </span>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition whitespace-nowrap"
          >
            Export CSV
          </button>
        </div>

        {/* Bulk Assign Bar */}
        {selectedIds.length > 0 && (
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 mb-6 flex flex-col sm:flex-row items-center gap-3">
            <span className="text-xs font-bold text-blue-900 whitespace-nowrap">
              {selectedIds.length} selected
            </span>
            <select
              value={bulkStaffId}
              onChange={(e) => setBulkStaffId(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white outline-none"
            >
              <option value="">Select staff…</option>
              {staffList.filter((st) => st.role === "staff").map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.role})
                </option>
              ))}
            </select>
            <select
              value={bulkPriority}
              onChange={(e) => setBulkPriority(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white outline-none"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={assigning || !bulkStaffId}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {assigning ? "Assigning…" : `Assign ${selectedIds.length}`}
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-slate-500 hover:text-slate-800 underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Messages */}
        {successMessage && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Invoice Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={visibleInvoices.length > 0 && visibleInvoices.every((i) => selectedIds.includes(i.id))}
                      onChange={toggleSelectVisible}
                      title="Select all shown"
                    />
                  </th>
                  <th className="px-6 py-3.5">Invoice ID / S3 Key</th>
                  <th className="px-6 py-3.5">Client</th>
                  <th className="px-6 py-3.5">Outlet</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Details</th>
                  <th className="px-6 py-3.5">Assigned To</th>
                  <th className="px-6 py-3.5">Priority</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                      {loading ? "Loading invoices..." : "No invoices found matching criteria."}
                    </td>
                  </tr>
                ) : (
                  visibleInvoices.map((inv) => {
                    const isAssignReady = inv.status === "uploaded" || inv.status === "ocr_done" || inv.status === "ocr_failed";
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(inv.id)}
                            onChange={() => toggleSelect(inv.id)}
                          />
                        </td>
                        <td className="px-6 py-4 font-mono text-slate-800">
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            className="text-blue-600 hover:underline font-semibold"
                          >
                            {inv.id.substring(0, 8)}...
                          </Link>
                          <div className="text-[10px] text-slate-400 truncate max-w-[160px]">
                            {inv.s3Key}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-800">{inv.client?.name || "Unknown"}</div>
                          <div className="text-[11px] text-slate-500">{inv.client?.phone || inv.client?.email}</div>
                        </td>
                        <td className="px-6 py-4">
                          {inv.outlet ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold">
                              {inv.outlet.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">No outlet</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase ${
                              inv.status === "collected"
                                ? "bg-emerald-100 text-emerald-800"
                                : inv.status === "ocr_failed" || inv.status === "disputed"
                                ? "bg-red-100 text-red-800"
                                : inv.status === "ocr_done"
                                ? "bg-blue-100 text-blue-800"
                                : inv.status === "assigned"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {inv.ocrData ? (
                            <div>
                              <div className="font-semibold text-slate-900">
                                ${inv.ocrData.amount || "—"}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {inv.ocrData.vendor || "No vendor"} &bull; Conf: {inv.ocrData.confidence || "0"}%
                              </div>
                            </div>
                          ) : inv.status === "ocr_failed" ? (
                            <span className="text-red-600 text-[11px] font-medium flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> Manual entry needed
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">Manual entry</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {inv.assignedStaff ? (
                            <span className="font-medium text-slate-700">
                              {inv.assignedStaff.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              inv.priority === "urgent"
                                ? "bg-red-50 text-red-600"
                                : inv.priority === "low"
                                ? "bg-slate-100 text-slate-600"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {inv.priority}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          {isAssignReady && !inv.assignedTo && (
                            <button
                              onClick={() => {
                                setSelectedInvoice(inv);
                                setSelectedStaffId(staffList.find((x) => x.role === "staff")?.id || "");
                              }}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition"
                            >
                              Assign
                            </button>
                          )}
                          {inv.status === "assigned" && (
                            <button
                              onClick={() => {
                                setSelectedInvoice(inv);
                                setSelectedStaffId(inv.assignedTo || staffList.find((x) => x.role === "staff")?.id || "");
                              }}
                              className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium transition"
                              title="Fix a mis-assignment"
                            >
                              Re-assign
                            </button>
                          )}
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium transition"
                          >
                            View <ArrowRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Assignment Modal */}
        {selectedInvoice && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
              <h3 className="text-base font-bold text-slate-900 mb-2">
                Assign Invoice {selectedInvoice.id.substring(0, 8)}...
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Current Status: <strong className="text-slate-800">{selectedInvoice.status}</strong>.
                Assigning will transition this invoice to <strong className="text-blue-600">assigned</strong>.
              </p>

              {assignError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  {assignError}
                </div>
              )}

              <form onSubmit={handleAssign} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Staff Member
                  </label>
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none bg-slate-50"
                  >
                    {staffList.filter((st) => st.role === "staff").map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name} ({st.email}) &bull; {st.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={assignPriority}
                    onChange={(e) => setAssignPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none bg-slate-50"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedInvoice(null)}
                    className="flex-1 py-2 px-4 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={assigning}
                    className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {assigning ? "Assigning..." : "Confirm Assignment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
