import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import EmergencyBanner from "@/components/EmergencyBanner";
import { AuthProvider } from "@/lib/AuthProvider";

export const metadata: Metadata = {
  title: "Family Medicine Consult — Physician-Led Telemedicine",
  description:
    "Physician-led family medicine consultations, supported by smart technology. Real physician care, real decisions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[var(--background)] font-sans text-[var(--foreground)]">
        <AuthProvider>
          <NavBar />
          <EmergencyBanner />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
