import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description:
    "Answers about online consultations, how your doctor uses your information, consultation fees, prescriptions and what to do in an emergency.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
