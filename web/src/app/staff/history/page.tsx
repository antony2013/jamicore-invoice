"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, History, User } from "lucide-react";
import AppShell from "@/components/AppShell";

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
    <AppShell
      role="staff"
      title="My Activity"
      subtitle="Status changes you performed, newest first"
      actions={
        <div className="flex items-center gap-2">
          <Link href="/staff/dashboard" className="dc-btn">
            My Invoices
          </Link>
          <button onClick={load} className="dc-btn" type="button">
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      }
    >
        <div className="dc-card p-6">
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
      </AppShell>
  );
}
