/** @type {import('next').NextConfig} */
// import { SERVER_URL } from "@/utils/commonHelper";
// const server_url = require("../utils/commonHelper");
const nextConfig = {
  outputFileTracingRoot: __dirname,
  eslint: {
    // Production builds must fail when application lint checks fail.
    // Lint findings are release-blocking rather than silently ignored.
    ignoreDuringBuilds: false,
  },
  typescript: {
    // !! REQUIRED !!
    // Production builds must fail when TypeScript validation fails.
    // Type errors cannot be bypassed in release builds.
    // !! REQUIRED !!
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return [
      // {
      //   source: "/api/speech/:path*",
      //   destination: `${server_url}/api/speech/:path*`,
      // },
    ];
  },
  // Enable React Strict Mode
  // NOTE: Disabled because React Strict Mode double-invokes effects in dev,
  // which destroys SSE (EventSource) connections immediately on mount.
  reactStrictMode: false,
  // Configure images if needed
  images: {
    domains: ['*'],
  },
  // Output directory for the build
  distDir: '.next',
  // Enable static HTML export
  output: 'standalone',
  // Enable server components
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID,
  },
};

module.exports = nextConfig;
