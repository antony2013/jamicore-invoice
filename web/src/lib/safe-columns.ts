/**
 * Safe column maps for Drizzle relational queries.
 * clients.passwordHash, staff.passwordHash and client_staff.pinHash must
 * NEVER reach the browser — every `with:` that is serialized into an API
 * response must use these instead of `true`.
 *
 * Usage: with: { client: safeClient, assignedStaff: safeStaff }
 */

export const safeClient = {
  columns: {
    passwordHash: false,
  },
} as const;

export const safeStaff = {
  columns: {
    passwordHash: false,
  },
} as const;

export const safeClientStaff = {
  columns: {
    pinHash: false,
  },
} as const;

/**
 * Test/guard helper: recursively fails when any key that could carry a
 * credential hash exists anywhere in a JSON payload.
 * Throws on the first hit (message includes the JSON path).
 */
const SECRET_KEYS = new Set(["passwordHash", "pinHash", "password_hash", "pin_hash"]);

export function assertNoSecrets(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) {
        throw new Error(`Secret leak at ${path}.${k}`);
      }
      assertNoSecrets(v, `${path}.${k}`);
    }
  }
}
