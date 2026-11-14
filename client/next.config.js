/** @type {import('next').NextConfig} */

// Legacy screens were retired in favour of the /app workspace. Old links and
// bookmarks land on the matching v2 page.
const LEGACY_REDIRECTS = [
  ["/dashboard", "/app"],
  ["/cases", "/app/investigations"],
  ["/cases/:id", "/app/investigations/:id"],
  ["/chat", "/app/ask"],
  ["/inbox", "/app/documents"],
  ["/records", "/app/documents"],
  ["/purchase-orders", "/app/orders"],
  ["/audit", "/app/audit"],
  ["/evaluation", "/research"],
  ["/contracts", "/app"],
  ["/outbox", "/app/settings"],
  ["/predictive-risk", "/app/suppliers"],
  ["/analyst/:path*", "/app"],
  ["/citizen/:path*", "/app"],
  ["/graph", "/app/investigations"],
];

const nextConfig = {
  outputFileTracingRoot: __dirname,
  // The Docker image runs the standalone server; Vercel builds normally.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // SSE copilot streams don't survive Strict Mode's double-mounted effects in dev.
  reactStrictMode: false,
  poweredByHeader: false,
  // Release builds fail on lint or type errors — never bypassed.
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  async redirects() {
    return LEGACY_REDIRECTS.map(([source, destination]) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
