import type { MetadataRoute } from "next";

// Makes the site installable as a home-screen app on both Android and
// iOS (2026-09-30, physician: "can we turn this into an phone app with
// no cost"). This — a Progressive Web App manifest, not an app-store
// listing — is the genuinely free path: no Apple Developer Program
// ($99/year) or Google Play Console ($25) fee, no separate codebase.
// Android shows an automatic "Install app" prompt; iPhone users add it
// manually via Share → Add to Home Screen (Safari doesn't offer an
// automatic prompt the way Android does — a real, documented iOS
// limitation, not something a manifest file can work around).
//
// Colors match the site's own brand mark exactly (NavBar.tsx's logo
// gradient: teal-500 → brand-950), and the icon files referenced below
// were generated from that same logo mark, not a placeholder.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Medic — Digital Family Clinic",
    short_name: "Family Medic",
    description:
      "Your family doctor, available digitally. Online consultations, family health records, and follow-up care for every member of your family.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f5c53",
    // Long-press the home-screen icon (Android) to jump straight into the Locator. (Locator added 2026-11.)
    shortcuts: [
      { name: "Find near me", short_name: "Find near me", description: "Doctors, clinics, pharmacies and more", url: "/locator", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Vaccination centres", short_name: "Vaccination", description: "Where to get children's vaccines", url: "/locator?tab=vaccination", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Pharmacies near me", short_name: "Pharmacies", url: "/locator?tab=pharmacy", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Doctors and clinics", short_name: "Clinics", url: "/locator?tab=doctor", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
