import type { Metadata } from "next";

// SEO batch (2026-10-07): page title/description for a page that is a
// client component (or whose file we leave untouched), so it can't export
// `metadata` itself. A layout holds it instead; the page is unchanged.
export const metadata: Metadata = {
  title: { default: "Free Health Tools", template: "%s | Family Medic" },
  description:
    "Free health tools from Family Medic: the Habit Age quiz, a BMI calculator and a pregnancy due date calculator. No account needed, nothing personal stored.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
