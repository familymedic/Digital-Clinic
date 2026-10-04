import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import EmergencyBanner from "@/components/EmergencyBanner";
import PageViewTracker from "@/components/PageViewTracker";
import AppInstallTracker from "@/components/AppInstallTracker";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { AuthProvider } from "@/lib/AuthProvider";

export const metadata: Metadata = {
  title: "Family Medic — Digital Family Clinic",
  description:
    "Your family doctor, available digitally. Online consultations, family health records, and follow-up care for every member of your family.",
  // PWA installability (2026-09-30) — the manifest itself lives in
  // app/manifest.ts and is picked up automatically by Next.js; this
  // block covers the two things that file can't: the icon set (so the
  // browser tab, Android install prompt, and iOS "Add to Home Screen"
  // all show the real brand mark instead of a blank/default icon) and
  // the iOS-specific "web app capable" hints, which only take effect
  // through this metadata API, not the manifest.
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Family Medic",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f5c53",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[var(--background)] font-sans text-[var(--foreground)]">
        <AuthProvider>
          <ServiceWorkerRegister />
          <PageViewTracker />
          <AppInstallTracker />
          <NavBar />
          <EmergencyBanner />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
