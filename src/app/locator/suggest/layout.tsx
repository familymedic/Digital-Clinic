import type { Metadata } from "next";
import { SERVICE_AREA_TEXT } from "@/lib/locator";

export const metadata: Metadata = {
  title: "Suggest a Place for the Locator",
  description:
    `Add a clinic or an autism-aware place to the Family Medic Locator in ${SERVICE_AREA_TEXT}. Free. A volunteer or our team confirms every place before it appears.`,
  alternates: { canonical: "/locator/suggest" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
