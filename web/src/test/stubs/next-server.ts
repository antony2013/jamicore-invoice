/**
 * Minimal `next/server` stub for vitest (the real module is not importable
 * outside Next). Routes only use NextResponse (+ instanceof) and the
 * NextRequest type. Includes a tiny `cookies` jar so routes that set
 * cookies (impersonation) stay production-identical under test.
 */

type CookieOpts = {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
};

export class NextResponse extends Response {
  cookies: {
    set: (name: string, value: string, opts?: CookieOpts) => void;
    get: (name: string) => { value: string } | undefined;
  };

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    const jar = new Map<string, string>();
    const headers = this.headers;
    this.cookies = {
      set(name: string, value: string, opts: CookieOpts = {}) {
        jar.set(name, value);
        let c = `${name}=${value}`;
        if (opts.maxAge !== undefined) c += `; Max-Age=${opts.maxAge}`;
        if (opts.path) c += `; Path=${opts.path}`;
        if (opts.sameSite) c += `; SameSite=${opts.sameSite}`;
        if (opts.secure) c += `; Secure`;
        if (opts.httpOnly) c += `; HttpOnly`;
        headers.append("Set-Cookie", c);
      },
      get(name: string) {
        return jar.has(name) ? { value: jar.get(name)! } : undefined;
      },
    };
  }

  static json(body: unknown, init?: ResponseInit): NextResponse {
    const text = JSON.stringify(body);
    return new NextResponse(text, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  }
}

export class NextRequest extends Request {}
