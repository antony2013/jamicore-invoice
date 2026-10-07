import type { NextConfig } from "next";

// S3 origin for CSP (presigned PUT/GET + PDF iframes). Derived from
// S3_ENDPOINT at build time; falls back to the local dev endpoint.
const isDev = process.env.NODE_ENV !== "production";

function s3Origin(): string {
  const ep = (process.env.S3_ENDPOINT ?? "").trim();
  if (!ep) {
    if (!isDev) throw new Error("S3_ENDPOINT is required in production for CSP");
    return "http://localhost:4566";
  }
  try {
    const u = new URL(ep.startsWith("http") ? ep : `https://${ep}`);
    return u.origin;
  } catch {
    if (!isDev) throw new Error(`Invalid S3_ENDPOINT for CSP: ${ep}`);
    return "http://localhost:4566";
  }
}

const S3 = s3Origin();

const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${S3}`,
  `frame-src ${S3}`,
  `connect-src 'self' ${S3}`,
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // No next/image remotePatterns: the app uses plain <img> (private-bucket
  // signed URLs) and <iframe> for PDF previews — nothing to optimize remotely.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Don't let our pages be iframed elsewhere (our own PDF <iframe>
          // embeds S3 URLs, not our pages, so SAMEORIGIN is safe).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
