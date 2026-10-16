"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown on staff pages while an admin is viewing as that staffer.
 * Reads the public session endpoint (no SessionProvider needed).
 */
export default function ImpersonationBanner() {
  const router = useRouter();
  const [state, setState] = useState<{ active: boolean; staffName: string }>({ active: false, staffName: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (!cancelled && data?.user?.impersonatedBy) {
          setState({ active: true, staffName: data.user.name || "staff" });
        }
      } catch {
        // banner stays hidden; staff UI is unaffected
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/stop-impersonate", { method: "POST" });
      const data = await res.json();
      router.push(data.success && data.redirect ? data.redirect : "/admin/staff");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!state.active) return null;
  return (
    <div className="mb-2 flex items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
      <span>
        <strong>Admin view:</strong> seeing staff dashboard as <strong>{state.staffName}</strong> — no changes are made as them unless you act.
      </span>
      <button
        onClick={stop}
        disabled={busy}
        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? "Exiting…" : "Exit staff view"}
      </button>
    </div>
  );
}
