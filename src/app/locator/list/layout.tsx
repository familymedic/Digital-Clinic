import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "List Your Clinic, Pharmacy or Therapy Centre on the Family Medic Locator",
  description:
    "Get your clinic, pharmacy, lab, hospital or therapy and rehab centre found by families near you in Karachi. Drop a pin, verify your documents and pay a small annual fee. You get a page that shows how many people found you.",
  alternates: { canonical: "/locator/list" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
