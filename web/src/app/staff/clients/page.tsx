"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Building2, ChevronRight } from "lucide-react";

import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ClientSummary = {
  id: string;
  name: string;
  pending: number;
  total: number;
};

export default function StaffClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unreadByClient, setUnreadByClient] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [res, threadsRes] = await Promise.all([
          fetch("/api/invoices?assigned_to=me&limit=200"),
          fetch("/api/threads?folder=all&limit=100"),
        ]);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to load clients");

        const byId = new Map<string, ClientSummary>();
        for (const inv of data.invoices as any[]) {
          const id = inv.clientId || inv.client?.id || "unknown";
          const name = inv.client?.name || (id === "unknown" ? "Unknown client" : id.substring(0, 8));
          const entry = byId.get(id) ?? { id, name, pending: 0, total: 0 };
          entry.total += 1;
          if (inv.status === "assigned" || inv.status === "in_review" || inv.status === "needs_info") {
            entry.pending += 1;
          }
          byId.set(id, entry);
        }

        const threadsData = await threadsRes.json();
        const counts: Record<string, number> = {};
        if (threadsData.success) {
          for (const thread of threadsData.threads as Array<{
            client?: { id?: string };
            unread?: number;
          }>) {
            const clientId = thread.client?.id;
            if (!clientId) continue;
            counts[clientId] = (counts[clientId] ?? 0) + Number(thread.unread ?? 0);
          }
        }

        if (!cancelled) {
          setUnreadByClient(counts);
          setClients(
            Array.from(byId.values()).sort(
              (a, b) => b.pending - a.pending || a.name.localeCompare(b.name)
            )
          );
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || "Failed to load clients.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && clients.length === 1) {
      router.replace(`/staff/clients/${encodeURIComponent(clients[0].id)}`);
    }
  }, [loading, clients, router]);

  return (
    <AppShell
      role="staff"
      title="Clients"
      subtitle="Your assigned client accounts"
    >
      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {loadError}
        </div>
      )}

      {loading && clients.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading clients…</p>
      ) : clients.length === 0 ? (
        <div className="py-12 bg-white rounded-2xl border border-slate-200 text-center">
          <p className="text-sm font-medium text-slate-600">No clients assigned yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Client accounts appear here once invoices are assigned to you.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {clients.map((c) => (
            <Card
              key={c.id}
              onClick={() => router.push(`/staff/clients/${encodeURIComponent(c.id)}`)}
              className="p-4 cursor-pointer transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.total} invoice{c.total === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  title={
                    (unreadByClient[c.id] ?? 0) > 0
                      ? `${unreadByClient[c.id]} unread message${unreadByClient[c.id] === 1 ? "" : "s"}`
                      : "No unread messages"
                  }
                  aria-label={`${c.name} messages (${unreadByClient[c.id] ?? 0} unread)`}
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/staff/messages?client=${encodeURIComponent(c.id)}`);
                  }}
                  className="relative -m-1 p-1 rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 flex-shrink-0"
                >
                  <Bell className="w-4 h-4" />
                  {(unreadByClient[c.id] ?? 0) > 0 && (
                    <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[10px] text-white flex items-center justify-center">
                      {unreadByClient[c.id]}
                    </Badge>
                  )}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                <span>{c.pending} pending action{c.pending === 1 ? "" : "s"}</span>
                <span className="inline-flex items-center gap-0.5 text-blue-600 font-semibold">
                  Open <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
