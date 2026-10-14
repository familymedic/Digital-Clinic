import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import EmergencyBanner from "@/components/EmergencyBanner";
import PageViewTracker from "@/components/PageViewTracker";
import AppInstallTracker from "@/components/AppInstallTracker";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { AuthProvider } from "@/lib/AuthProvider";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import { jsonLdString, siteJsonLd } from "@/lib/siteJsonLd";

// SEO batch (2026-10-07). Positioning is continuity of care for families
// (one account for the whole family, doctors you can return to) — NOT
// diaspora-targeted. `metadataBase` makes every relative URL below
// absolute; `alternates.canonical: "./"` gives each page its own
// self-referencing canonical (stops ?utm= / www-vs-apex duplicates from
// splitting ranking). Verification tokens come from env vars (server-side
// only, never NEXT_PUBLIC_) so they can be added in Vercel with no code
// change once Search Console / Bing Webmaster are set up.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_PK",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "./",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(siteJsonLd()) }}
        />
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
