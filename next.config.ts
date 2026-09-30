import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // PWA service worker (2026-09-30): explicitly stop browsers/CDNs from
  // caching sw.js for long. A stale cached service worker is a classic
  // PWA foot-gun — a later fix to sw.js (e.g. once push notifications
  // are wired in) wouldn't actually reach a returning visitor's browser
  // for a long time otherwise. Static files under /public are otherwise
  // fine to cache normally; this header targets only this one file.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
