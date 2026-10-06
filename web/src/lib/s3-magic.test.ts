import { describe, expect, it } from "vitest";
import { checkMagicBytes } from "@/lib/s3";

const u8 = (arr: number[]) => new Uint8Array(arr);

describe("checkMagicBytes", () => {
  it("accepts JPEG / PNG / PDF / XLSX signatures", () => {
    expect(checkMagicBytes(u8([0xff, 0xd8, 0xff, 0xe0]), "jpg")).toBe(true);
    expect(
      checkMagicBytes(u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png")
    ).toBe(true);
    expect(checkMagicBytes(u8([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), "pdf")).toBe(true);
    expect(checkMagicBytes(u8([0x50, 0x4b, 0x03, 0x04, 0x14]), "xlsx")).toBe(true);
  });

  it("rejects cross-type content", () => {
    const pdf = u8([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(checkMagicBytes(pdf, "jpg")).toBe(false);
    expect(checkMagicBytes(pdf, "png")).toBe(false);
    expect(checkMagicBytes(pdf, "xlsx")).toBe(false);
    const zip = u8([0x50, 0x4b, 0x03, 0x04]);
    expect(checkMagicBytes(zip, "pdf")).toBe(false);
  });

  it("rejects truncated buffers", () => {
    expect(checkMagicBytes(u8([0xff, 0xd8]), "jpg")).toBe(false);
    expect(checkMagicBytes(u8([]), "pdf")).toBe(false);
    expect(checkMagicBytes(u8([0x50, 0x4b]), "xlsx")).toBe(false);
  });
});
