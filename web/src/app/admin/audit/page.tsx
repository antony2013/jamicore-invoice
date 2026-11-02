"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import AppShell from "@/components/AppShell";

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
    <AppShell
      role="admin"
      title="Audit Log"
      subtitle="Append-only audit entries for admin review."
      actions={
        <Link href="/admin/dashboard" className="dc-btn">
          Back to Queue
        </Link>
      }
    >
        <div className="dc-card mb-6 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-700">Entity</span>
              <input
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder="invoice, client, staff…"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-700">Actor</span>
              <input
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="staff, client…"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-700">Action prefix</span>
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="invoice.…"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-700">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-700">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
          <button
            onClick={() => load(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800 sm:w-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Apply
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Phones and tablets: one card per entry, every field visible without a sideways scroll */}
        <div className="space-y-2 xl:hidden">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">
              {loading ? "Loading audit log…" : "No entries match."}
            </div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 break-words font-mono text-[11px] font-semibold text-slate-800">
                    {e.action}
                  </div>
                  <div className="flex-shrink-0 text-[11px] text-slate-500">
                    {new Date(e.at).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div className="min-w-0">
                    <div className="text-slate-400">Actor</div>
                    <div className="font-semibold text-slate-700">{e.actorType}</div>
                    {e.actorId && (
                      <div className="truncate font-mono text-[11px] text-slate-400">
                        {e.actorId.slice(0, 8)}…
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-slate-400">Entity</div>
                    <div className="font-semibold text-slate-700">{e.entityType}</div>
                    {e.entityId && (
                      <div className="truncate font-mono text-[11px] text-slate-400">
                        {e.entityId.slice(0, 8)}…
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 min-w-0">
                    <span className="text-slate-400">IP </span>
                    <span className="font-mono text-slate-600">{e.ip || "—"}</span>
                  </div>
                </div>
                {(e.before || e.after || e.meta) && (
                  <details className="mt-2 border-t border-slate-100 pt-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                      Before → After
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-500">
                      {`before: ${shortJson(e.before)}\nafter:  ${shortJson(e.after)}`}
                      {e.meta ? `\nmeta:   ${shortJson(e.meta)}` : ""}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm xl:block">
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
                      {e.actorId && <div className="font-mono text-[11px] text-slate-400">{e.actorId.slice(0, 8)}…</div>}
                    </td>
                    <td className="px-4 py-3 font-mono">{e.action}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold">{e.entityType}</span>
                      {e.entityId && <div className="font-mono text-[11px] text-slate-400">{e.entityId.slice(0, 8)}…</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
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
      </AppShell>
  );
}
