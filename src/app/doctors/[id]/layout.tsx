import type { Metadata } from "next";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { jsonLdString } from "@/lib/siteJsonLd";

// SEO batch (2026-10-07): the doctor profile page itself is a client
// component (it fetches in the browser), so search engines would see only
// a generic title. This layout looks the doctor up on the SERVER from the
// same public_doctor_directory view the page uses (so only approved,
// public doctors ever appear) and supplies: a real title + description,
// a share image, and Physician structured data. Unknown / unapproved ids
// get a noindex generic title. Nothing here exposes anything the public
// profile page doesn't already show.

interface PublicDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  bio: string | null;
  years_of_experience: number | null;
  profile_photo_url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// cache() so generateMetadata and the layout body share one query.
const getDoctor = cache(async (id: string): Promise<PublicDoctor | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !UUID_RE.test(id)) return null;
  try {
    const db = createClient(url, key);
    const { data } = await db
      .from("public_doctor_directory")
      .select("id, full_name, specialty, bio, years_of_experience, profile_photo_url")
      .eq("id", id)
      .maybeSingle();
    return (data as PublicDoctor | null) ?? null;
  } catch {
    return null;
  }
});

function describe(d: PublicDoctor): string {
  const lead = `${d.full_name}${d.specialty ? `, ${d.specialty}` : ""} — PMDC-verified doctor on ${SITE_NAME}.`;
  const bio = (d.bio ?? "").replace(/\s+/g, " ").trim();
  const text = bio ? `${lead} ${bio}` : `${lead} Book a video, audio or text consultation.`;
  return text.length > 158 ? `${text.slice(0, 155).trimEnd()}…` : text;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const d = await getDoctor(id);
  if (!d) {
    return { title: "Doctor profile", robots: { index: false, follow: true } };
  }
  const title = `${d.full_name}${d.specialty ? ` — ${d.specialty}` : ""}`;
  const description = describe(d);
  return {
    title,
    description,
    alternates: { canonical: `/doctors/${d.id}` },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `/doctors/${d.id}`,
      ...(d.profile_photo_url ? { images: [{ url: d.profile_photo_url }] } : {}),
    },
  };
}

export default async function DoctorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const d = await getDoctor(id);
  const jsonLd = d
    ? {
        "@context": "https://schema.org",
        "@type": "Physician",
        name: d.full_name,
        url: `${SITE_URL}/doctors/${d.id}`,
        ...(d.specialty ? { description: `${d.specialty}. ${describe(d)}` } : { description: describe(d) }),
        ...(d.profile_photo_url ? { image: d.profile_photo_url } : {}),
        worksFor: { "@id": `${SITE_URL}/#organization` },
      }
    : null;
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
