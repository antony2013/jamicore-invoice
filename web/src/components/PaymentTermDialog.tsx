"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Payment Terms "Custom" is defined through this dialog instead of an inline
 * countdown: a name for the term and how many days after approval it is due.
 */
export default function PaymentTermDialog({
  open,
  name = "",
  days = "",
  onSave,
  onClose,
}: {
  open: boolean;
  name?: string;
  days?: string | number;
  onSave: (value: { name: string; days: number }) => void;
  onClose: () => void;
}) {
  const [termName, setTermName] = useState(name);
  const [dueAfter, setDueAfter] = useState(String(days ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTermName(name);
    setDueAfter(String(days ?? ""));
    setError(null);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, name, days, onClose]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = termName.trim();
    const numeric = Number(dueAfter);
    if (!cleanName) {
      setError("Term Name is required.");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Due After must be more than 0 days.");
      return;
    }
    onSave({ name: cleanName, days: Math.round(numeric) });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Payment Term"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-bold text-slate-900">New Payment Term</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment term"
            className="rounded border border-blue-300 p-1 text-blue-600 hover:bg-blue-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="flex items-center gap-4">
            <label className="w-24 flex-shrink-0 text-xs font-semibold text-red-600">
              Term Name*
            </label>
            <input
              autoFocus
              value={termName}
              onChange={(e) => setTermName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Net 45"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-24 flex-shrink-0 text-xs font-semibold text-red-600">
              Due After*
            </label>
            <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-blue-500">
              <input
                type="number"
                min="1"
                max="3650"
                step="1"
                value={dueAfter}
                onChange={(e) => setDueAfter(e.target.value)}
                placeholder="Days"
                className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
              />
              <span className="flex items-center border-l border-slate-300 bg-slate-50 px-3 text-xs text-slate-600">
                Days
              </span>
            </div>
          </div>
          {error && <p className="pl-28 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
