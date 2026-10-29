"use client";

import { useEffect, useState } from "react";

/**
 * "Move report to Trash" dialog. A remark is mandatory — the Trash view shows
 * it next to the entry so anyone restoring the file knows why it went away.
 */
export default function ReportDeleteDialog({
  report,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  report: { id: string; fileName: string } | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    setReason("");
  }, [report?.id]);

  useEffect(() => {
    if (!report) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, busy, onCancel]);

  if (!report) return null;

  const tooShort = reason.trim().length < 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-delete-title"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <h2 id="report-delete-title" className="text-sm font-bold text-slate-900">
          Move report to Trash?
        </h2>
        <p className="mt-1 truncate text-[11px] text-slate-500">{report.fileName}</p>

        <label
          htmlFor="report-delete-reason"
          className="mt-4 block text-[11px] font-semibold text-slate-700"
        >
          Reason for deleting (required)
        </label>
        <textarea
          id="report-delete-reason"
          autoFocus
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Wrong invoice — re-uploaded the correct file"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-red-100"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          The file is kept in Trash and can be restored later.
        </p>

        {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="dc-btn disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || tooShort}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
