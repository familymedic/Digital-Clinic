import type { Metadata } from "next";

// Habit Age (migration 0084). The pages are client components, so the page
// title and description live here.
export const metadata: Metadata = {
  title: { default: "Habit Age: How old are your habits?", template: "%s | Family Medic" },
  description:
    "A free, fun 1-minute quiz about everyday habits. Get your Habit Age and see how your city is doing. For fun, not a medical assessment.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
