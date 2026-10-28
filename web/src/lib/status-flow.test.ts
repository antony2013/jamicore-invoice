import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  InvoiceStatus,
  isTerminalStatus,
  isValidTransition,
} from "@/lib/status-flow";

const ALL: InvoiceStatus[] = [
  "uploaded",
  "ocr_pending",
  "ocr_done",
  "ocr_failed",
  "assigned",
  "in_review",
  "needs_info",
  "verified",
  "collected",
  "disputed",
];

describe("status-flow matrix", () => {
  it("allows every documented transition", () => {
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of tos) {
        expect(isValidTransition(from as InvoiceStatus, to as InvoiceStatus)).toBe(true);
      }
    }
  });

  it("rejects every undocumented transition (except self, handled by callers)", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (to === from) continue;
        const allowed = (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(isValidTransition(from, to)).toBe(allowed);
      }
    }
  });

  it("collected is fully terminal; disputed only allows the re-open edge", () => {
    expect(isTerminalStatus("collected")).toBe(true);
    expect(ALLOWED_TRANSITIONS.collected).toEqual([]);
    for (const to of ALL) {
      if (to === "collected") continue;
      expect(isValidTransition("collected", to)).toBe(false);
    }

    // Returned stays "terminal" for edits/deletes but has ONE recovery
    // transition back into review (staff can pick the invoice back up).
    expect(isTerminalStatus("disputed")).toBe(true);
    expect(ALLOWED_TRANSITIONS.disputed).toEqual(["in_review"]);
    for (const to of ALL) {
      if (to === "disputed" || to === "in_review") continue;
      expect(isValidTransition("disputed", to)).toBe(false);
    }
  });

  it("non-terminal states are not terminal", () => {
    for (const s of ALL) {
      if (s === "collected" || s === "disputed") continue;
      expect(isTerminalStatus(s)).toBe(false);
    }
  });

  it("unknown statuses are invalid", () => {
    expect(isValidTransition("uploaded" as InvoiceStatus, "bogus" as InvoiceStatus)).toBe(false);
    expect(isValidTransition("bogus" as InvoiceStatus, "assigned")).toBe(false);
  });
});
