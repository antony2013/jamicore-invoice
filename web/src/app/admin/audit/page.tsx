"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ScrollText } from "lucide-react";

type Entry = {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: any;
  after: any;
  meta: any;
  ip: string | null;
};

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function params(cursor?: string | null) {
    const p = new URLSearchParams();
    if (entity.trim()) p.set("entity", entity.trim());
    if (actor.trim()) p.set("actor", actor.trim());
    if (action.trim()) p.set("action", action.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }

  async function load(reset = true) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit?${params(reset ? null : nextCursor)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load audit log");
      setEntries(reset ? data.entries : (prev: Entry[]) => [...prev, ...data.entries]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function shortJson(v: any) {
    if (v === null || v === undefined) return "—";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScrollText className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Audit Log</h1>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-500">
              append-only
            </span>
          </div>
          <Link href="/admin/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Queue
          </Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 flex flex-wrap items-center gap-3">
          <input
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="entity (invoice, client, staff…)"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="actor (staff, client…)"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="action prefix (invoice.…)"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 outline-none"
          />
          <button
            onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Apply
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Before → After</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    {loading ? "Loading audit log…" : "No entries match."}
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/80 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold">{e.actorType}</span>
                      {e.actorId && <div className="font-mono text-[10px] text-slate-400">{e.actorId.slice(0, 8)}…</div>}
                    </td>
                    <td className="px-4 py-3 font-mono">{e.action}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold">{e.entityType}</span>
                      {e.entityId && <div className="font-mono text-[10px] text-slate-400">{e.entityId.slice(0, 8)}…</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                      <div>{shortJson(e.before)}</div>
                      <div>→ {shortJson(e.after)}</div>
                      {e.meta && <div className="text-slate-400">{shortJson(e.meta)}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono">{e.ip || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => load(false)}
              disabled={loadingMore}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
