"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

export default function AppShell({
  role,
  title,
  subtitle,
  actions,
  children,
}: {
  role: "admin" | "staff";
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items =
    role === "admin"
      ? [
          { href: "/admin/dashboard", label: "Dashboard" },
          { href: "/admin/history", label: "History" },
          { href: "/admin/clients", label: "Clients" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/audit", label: "Audit log" },
        ]
      : [
          { href: "/staff/dashboard", label: "Dashboard" },
          { href: "/staff/history", label: "History" },
        ];

  return (
    <div className="dc-root">
      <aside className="dc-sidebar">
        <div className="dc-logo">Invoice Desk</div>
        <nav className="dc-nav">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="dc-footer">
          {role === "admin" ? "Admin" : "Staff"}
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
        <header className="dc-header">
          <div>
            <h1 className="m-0 text-[26px] font-semibold">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-[#475467]">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
        {children}
      </main>
    </div>
  );
}
