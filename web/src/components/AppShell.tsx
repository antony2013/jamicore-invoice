"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { FileText } from "lucide-react";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import NotificationBell from "@/components/NotificationBell";

export default function AppShell({
  role,
  title,
  subtitle,
  actions,
  nav,
  headerBrand,
  hideHeader,
  children,
}: {
  role: "admin" | "staff";
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  nav?: Array<{ href: string; label: string }>;
  headerBrand?: { name: string; subtitle?: string };
  hideHeader?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const defaultItems =
    role === "admin"
      ? [
          { href: "/admin/dashboard", label: "Dashboard" },
          { href: "/admin/history", label: "History" },
          { href: "/admin/clients", label: "Clients" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/reports", label: "Reports" },
          { href: "/admin/reports/trash", label: "Trash" },
          { href: "/admin/audit", label: "Audit log" },
        ]
      : [
          { href: "/staff/dashboard", label: "Dashboard" },
          { href: "/staff/history", label: "History" },
          { href: "/staff/clients", label: "Client" },
        ];
  const items = nav ?? defaultItems;

  // One active item only: the deepest matching path wins, so /reports/trash
  // does not also light up /reports. Query strings are ignored here.
  const pathOf = (href: string) => href.split("?")[0];
  const activeHref = items
    .map((item) => pathOf(item.href))
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <div className="dc-root">
      <aside className="dc-sidebar">
        <div className="dc-logo">Invoice Desk</div>
        <nav className="dc-nav">
          {items.map((item) => {
            const active = activeHref === pathOf(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="dc-footer">
          <span className="dc-role">{role === "admin" ? "Admin" : "Staff"}</span>
          <br />
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-left text-[13px] text-[#CBD5E1] hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="dc-main">
        {role === "staff" && <ImpersonationBanner />}
        {hideHeader ? null : (
        <header className={`dc-header ${headerBrand ? "dc-topbar" : ""}`}>
          {headerBrand ? (
            <div className="flex items-center gap-3">
              <span className="dc-brand-tile">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="dc-brand-name">{headerBrand.name}</div>
                {headerBrand.subtitle ? (
                  <div className="dc-brand-sub">{headerBrand.subtitle}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div>
              <h1 className="m-0 text-[26px] font-semibold">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-[#475467]">{subtitle}</p> : null}
            </div>
          )}
          <div className="dc-header-actions flex items-center gap-3">
            <NotificationBell />
            {actions}
          </div>
        </header>
        )}
        {children}
      </main>
    </div>
  );
}
