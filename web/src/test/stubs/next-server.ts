/**
 * Minimal `next/server` stub for vitest (the real module is not importable
 * outside Next). Routes only use NextResponse (+ instanceof) and the
 * NextRequest type.
 */
export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const text = JSON.stringify(body);
    return new NextResponse(text, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  }
}

export class NextRequest extends Request {}
