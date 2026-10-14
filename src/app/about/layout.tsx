import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: "About",
  description:
    "Family Medic is a digital family clinic: physician-led family medicine online, with continuity of care for every member of your family. Technology assists; the doctor decides.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
