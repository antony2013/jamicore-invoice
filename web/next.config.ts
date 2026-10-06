import type { NextConfig } from "next";

// S3 origin for CSP (presigned PUT/GET + PDF iframes). Derived from
// S3_ENDPOINT at build time; falls back to the local dev endpoint.
function s3Origin(): string {
  const ep = (process.env.S3_ENDPOINT || "http://192.168.1.13:4566").trim();
  try {
    const u = new URL(ep.startsWith("http") ? ep : `https://${ep}`);
    return u.origin;
  } catch {
    return "http://192.168.1.13:4566";
  }
}

const S3 = s3Origin();

// NOTE on script-src: Next.js dev + App Router inline bootstraps require
// 'unsafe-inline' for scripts; nonces per-request are not feasible with
// static prerendering here, so this is the documented minimum.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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
