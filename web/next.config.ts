import type { NextConfig } from "next";

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
          // embeds MinIO URLs, not our pages, so SAMEORIGIN is safe).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
