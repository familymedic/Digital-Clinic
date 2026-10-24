import type { Metadata } from "next";

// Habit Age (migration 0084). The pages are client components, so the page
// title and description live here.
export const metadata: Metadata = {
  title: { default: "Habit Age: Do your habits agree with your age?", template: "%s | Family Medic" },
  description:
    "Your birthday says one age. Do your habits agree? A free, fun 1-minute quiz about everyday habits: compare your real age with your Habit Age and see how your city is doing. For fun, not a medical assessment.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
