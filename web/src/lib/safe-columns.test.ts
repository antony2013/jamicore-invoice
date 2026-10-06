import { describe, expect, it } from "vitest";
import { assertNoSecrets } from "@/lib/safe-columns";
import { safeClient, safeClientStaff, safeStaff } from "@/lib/safe-columns";

describe("assertNoSecrets", () => {
  it("passes clean payloads", () => {
    expect(() =>
      assertNoSecrets({ id: "1", name: "x", nested: [{ a: 1 }], note: null })
    ).not.toThrow();
  });

  it("fails on every secret key variant, nested or in arrays", () => {
    for (const key of ["passwordHash", "pinHash", "password_hash", "pin_hash"]) {
      expect(() => assertNoSecrets({ user: { [key]: "abc" } })).toThrow(/Secret leak/);
      expect(() => assertNoSecrets([{ [key]: "abc" }])).toThrow(/Secret leak/);
    }
  });

  it("does not false-positive on password-adjacent words", () => {
    expect(() =>
      assertNoSecrets({ password: "plain?", passwordReset: true, message: "Password reset. Share it." })
    ).not.toThrow();
  });
});

describe("safe column maps", () => {
  it("excludes credential hashes", () => {
    expect(safeClient.columns).toEqual({ passwordHash: false });
    expect(safeStaff.columns).toEqual({ passwordHash: false });
    expect(safeClientStaff.columns).toEqual({ pinHash: false });
  });
});
