import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: "Online Family Medicine Services",
  description:
    "Everyday family health concerns, children's health, prescriptions, report review, follow-up and chronic-disease follow-up, with a doctor who gets to know your family.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
