/**
 * Fail-closed secret loading. Returns the env value when set; otherwise
 * throws UNLESS this is an explicit local dev run (NODE_ENV=development),
 * where a clearly-marked fallback is allowed. Production/test/CI must
 * provide real values (vitest config injects test-only values).
 */
export function requireSecret(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === "development") return devFallback;
  throw new Error(`${name} is not set. Refusing to start without it.`);
}
