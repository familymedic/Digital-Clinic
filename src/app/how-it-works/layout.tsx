import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: "How It Works",
  description:
    "Book a consultation, share your concern, and meet your doctor by video, audio or text. Your doctor reviews everything, decides your care and follows up with you.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
