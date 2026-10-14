import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// robots.txt (SEO batch, 2026-10-07). Blocks only the private/app areas
// (accounts, consultations, admin, doctor portal, API) — everything public
// stays crawlable. Login/register pages are NOT blocked here on purpose:
// they carry a `noindex` header (next.config.ts) which crawlers can only
// see if they are allowed to fetch the page. "/doctor/" has a trailing
// slash so it blocks the doctor portal but NOT the public "/doctors"
// directory.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/dashboard", "/doctor/", "/consultation/", "/book"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
