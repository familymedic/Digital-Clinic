import type { Metadata } from "next";

// A saved appointment link works like a key to one appointment, so it is
// never indexed, and the address is not passed on to other sites.
export const metadata: Metadata = {
  title: "Opening your appointment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AppointmentLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
