"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, History, User } from "lucide-react";

export default function StaffHistoryPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/history?limit=100");
      const data = await res.json();
      if (data.success) setLogs(data.logs);
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-slate-700" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">My Activity</h1>
              <p className="text-[11px] text-slate-500">Status changes you performed, newest first</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/staff/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-3.5 h-3.5" /> My Invoices
            </Link>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          {loading && logs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading history...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              No activity yet — verify an invoice to see your actions here.
            </p>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {logs.map((log) => (
                <div key={log.id} className="relative">
                  <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-800">
                      {log.status}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                    {log.invoice && (
                      <Link
                        href={`/staff/invoices/${log.invoice.id}`}
                        className="text-[11px] text-blue-600 hover:underline font-mono"
                      >
                        {log.invoice.id.substring(0, 8)}… ({log.invoice.clientName})
                      </Link>
                    )}
                  </div>
                  {log.note && <p className="text-xs text-slate-600 mt-0.5">{log.note}</p>}
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {log.actor ? `${log.actor.name} (${log.actor.role})` : "Automated System / Worker"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
