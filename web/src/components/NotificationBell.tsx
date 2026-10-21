"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, FileText, MessageSquare } from "lucide-react";

type NotificationItem = {
  id: string;
  type: "message" | "report_request" | "invoice";
  title: string;
  body: string;
  href: string;
  createdAt: string;
};

function timeAgo(value: string): string {
  const t = value ? new Date(value).getTime() : 0;
  if (!t) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setUnread(Number(data.unread) || 0);
      }
    } catch {
      // Keep the last known feed on transient failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function markAllRead() {
    setMarking(true);
    try {
      const res = await fetch("/api/notifications", { method: "POST" });
      if (res.ok) {
        setUnread(0);
        setItems((prev) => prev.filter((item) => item.type === "invoice"));
      }
    } catch {
      // Leave state untouched when the request fails.
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="dc-btn relative"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell className="inline h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[320px] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-900">Notifications</span>
            {items.some((item) => item.type !== "invoice") && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={marking}
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {marking ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400 text-center">Checking for notifications…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400 text-center">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                      item.type === "invoice"
                        ? "bg-amber-100 text-amber-700"
                        : item.type === "report_request"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {item.type === "invoice" ? (
                      <FileText className="h-3.5 w-3.5" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-900">{item.title}</span>
                    <span className="block truncate text-[11px] text-slate-500">{item.body}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5">{timeAgo(item.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
