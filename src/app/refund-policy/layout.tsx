import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "When and how consultation fees can be refunded on Family Medic.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
