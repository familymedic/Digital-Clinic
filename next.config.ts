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
      // Search-engine hygiene (SEO batch, 2026-10-07): account, booking,
      // consultation, admin and doctor-portal pages are private or
      // thin and must never appear in search results. `noindex` here is
      // an HTTP header, so it covers client-component pages too. (The
      // public "/doctors" directory is NOT matched — "/doctor/" needs the
      // slash.) /login and /register are noindex but still crawlable so
      // the header is actually seen (see robots.ts).
      {
        source:
          "/:path(login|register|forgot-password|reset-password|dashboard|book|feedback|admin|consultation)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:path(login|register|forgot-password|reset-password|dashboard|book|feedback|admin|consultation)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/doctor/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
