/**
 * Minimal `next-auth` stub for vitest. Route/page code only needs the
 * NextAuth() factory shape; auth behavior is mocked per-test via
 * vi.mock("@/lib/auth"). Callback logic is tested through the REAL
 * authOptions object (which this stub passes through untouched).
 */
export default function NextAuth(options: any) {
  return {
    handlers: { GET: async () => new Response("stub"), POST: async () => new Response("stub") },
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    _options: options,
  };
}
