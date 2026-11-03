import type { NextConfig } from "next";

// Every page reads the signed-in owner's data, so pages are rendered on each request
// (Cache Components is not used).
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["googleapis", "plaid"],
  // Push B: Outreach is now People. Old links and bookmarks keep working (the query string goes along).
  async redirects() {
    return [
      { source: "/work/outreach", destination: "/work/people", permanent: false },
      { source: "/work/outreach/:id", destination: "/work/people/:id", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      { source: "/report/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
