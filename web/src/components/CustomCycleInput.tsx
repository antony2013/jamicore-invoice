"use client";

import { Fragment } from "react";
import type { CustomCycleRow } from "@/lib/client-profile";

// Countdown-style boxes used by the "Custom" billing cycle and payment terms.
// Order and labels match YY : MM : DD : HH.
const FIELDS = [
  { unit: "years", short: "YY", full: "Years" },
  { unit: "months", short: "MM", full: "Months" },
  { unit: "days", short: "DD", full: "Days" },
  { unit: "hours", short: "HH", full: "Hours" },
] as const;

export default function CustomCycleInput({
  rows,
  onChange,
  size = "md",
  label,
}: {
  rows: CustomCycleRow[];
  onChange: (rows: CustomCycleRow[]) => void;
  size?: "md" | "sm";
  label: string;
}) {
  const amounts = FIELDS.map((field) => rows.find((row) => row.unit === field.unit)?.amount ?? "");

  function update(index: number, raw: string) {
    const digits = raw.replace(/[^\d]/g, "").slice(0, 3);
    onChange(
      FIELDS.map((field, i) => ({
        unit: field.unit as string,
        amount: i === index ? digits : amounts[i],
      })).filter((row) => row.amount !== "")
    );
  }

  const inputClass =
    size === "sm"
      ? "w-8 border-0 bg-transparent p-0 text-center text-xs font-semibold text-slate-900 outline-none"
      : "w-10 border-0 bg-transparent p-0 text-center text-sm font-semibold text-slate-900 outline-none";
  const boxClass =
    size === "sm"
      ? "flex flex-col items-center rounded-lg border border-slate-300 bg-white px-1 py-1 focus-within:ring-2 focus-within:ring-blue-500"
      : "flex flex-col items-center rounded-lg border border-slate-300 bg-white px-1.5 py-1 focus-within:ring-2 focus-within:ring-blue-500";

  return (
    <div className="flex items-center gap-1">
      {FIELDS.map((field, index) => (
        <Fragment key={field.unit}>
          <div
            className={boxClass}
            title={`${field.full}: type the number`}
          >
            <input
              type="text"
              inputMode="numeric"
              value={amounts[index]}
              onChange={(e) => update(index, e.target.value)}
              placeholder="00"
              aria-label={`${label} ${field.full.toLowerCase()}`}
              className={inputClass}
            />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              {field.short}
            </span>
          </div>
          {index < FIELDS.length - 1 && (
            <span className="text-xs font-semibold text-slate-400">:</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
