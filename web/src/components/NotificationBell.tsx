"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, FileText, MessageSquare, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const iconByType = {
  invoice: FileText,
  report_request: MessageSquare,
  message: MessageSquare,
} as const;

const chipByType = {
  invoice: "bg-amber-100 text-amber-700",
  report_request: "bg-violet-100 text-violet-700",
  message: "bg-blue-100 text-blue-700",
} as const;

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

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

  const hasMessages = items.some((item) => item.type !== "invoice");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative h-10 w-10 rounded-full border-slate-200 bg-white shadow-sm hover:bg-slate-50"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        >
          <Bell className="h-[18px] w-[18px] text-slate-700" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-[18px] min-w-[18px] justify-center rounded-full px-1 text-[10px] font-bold leading-none shadow"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[340px] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unread > 0 && (
              <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-bold">
                {unread} new
              </Badge>
            )}
          </div>
          {hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              disabled={marking}
              className="h-7 gap-1 px-2 text-[11px] text-blue-600 hover:text-blue-700"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {marking ? "Marking…" : "Mark all read"}
            </Button>
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />

        {loading && items.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Checking for notifications…
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Inbox className="h-6 w-6 text-slate-300" />
            <p className="text-xs text-muted-foreground">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[380px]">
            <div className="py-1">
              {items.map((item) => {
                const Icon = iconByType[item.type] ?? MessageSquare;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() => router.push(item.href)}
                    className="mx-1 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 focus:bg-slate-50"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${chipByType[item.type] ?? chipByType.message}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-900">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {item.body}
                      </span>
                      <span className="mt-1 block text-[10px] text-slate-400">
                        {timeAgo(item.createdAt)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DropdownMenuSeparator className="my-0" />
        <div className="px-4 py-2 text-center text-[10px] text-slate-400">
          {items.length > 0
            ? `${items.length} notification${items.length === 1 ? "" : "s"} · refreshes every minute`
            : "Updates automatically"}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
