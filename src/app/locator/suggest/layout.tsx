import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suggest a Place for the Locator",
  description:
    "Add a clinic or an autism-aware place to the Family Medic Locator in Karachi or Hyderabad. Free. A volunteer or our team confirms every place before it appears.",
  alternates: { canonical: "/locator/suggest" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
