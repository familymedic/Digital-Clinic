import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/site";

// sitemap.xml (SEO batch, 2026-10-07): the public static pages plus one URL
// per approved doctor profile, read from the same `public_doctor_directory`
// view the public /doctors page uses (so a doctor appears here only once
// they are approved/active — never a private profile). If the database
// can't be reached the sitemap simply lists the static pages; it never
// fails the build. Regenerated at most hourly.
export const revalidate = 3600;

const STATIC_PATHS = [
  "/",
  "/about",
  "/services",
  "/how-it-works",
  "/doctors",
  "/faq",
  "/calculators",
  "/calculators/bmi",
  "/calculators/due-date",
  "/contact",
  "/privacy",
  "/terms",
  "/refund-policy",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({
    url: `${SITE_URL}${p === "/" ? "" : p}`,
  }));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const db = createClient(url, key);
      const { data } = await db.from("public_doctor_directory").select("id");
      for (const d of data ?? []) {
        entries.push({ url: `${SITE_URL}/doctors/${d.id}` });
      }
    } catch {
      // keep the static entries
    }
  }
  return entries;
}
