import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/cursor";

describe("cursor", () => {
  it("round-trips createdAt + id", () => {
    const iso = "2026-10-06T07:45:48.258Z";
    const c = encodeCursor(iso, "9cc45e4b-6484-4b1d-95d4-14320cea10c6");
    expect(decodeCursor(c)).toEqual({
      createdAt: iso,
      id: "9cc45e4b-6484-4b1d-95d4-14320cea10c6",
    });
  });

  it("accepts Date input", () => {
    const c = encodeCursor(new Date("2026-01-01T00:00:00.000Z"), "x");
    expect(decodeCursor(c)?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects garbage, tampering and bad shapes", () => {
    expect(decodeCursor("garbage!!!")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    const tampered = encodeCursor("2026-01-01T00:00:00.000Z", "x").slice(0, -2) + "yy";
    expect(decodeCursor(tampered)).toBeNull();
    const noId = Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" })).toString("base64url");
    expect(decodeCursor(noId)).toBeNull();
    const badDate = Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: "x" })).toString("base64url");
    expect(decodeCursor(badDate)).toBeNull();
  });

  it("is opaque (no plaintext id visible)", () => {
    const id = "9cc45e4b-6484-4b1d-95d4-14320cea10c6";
    expect(encodeCursor("2026-01-01T00:00:00.000Z", id)).not.toContain(id);
  });
});
