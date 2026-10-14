import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: { default: "Find a Family Doctor Online", template: "%s | Family Medic" },
  description:
    "Browse PMDC-verified doctors by department, read their profiles and fees, and book a video, audio or text consultation. Return to the same doctor for follow-up.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
