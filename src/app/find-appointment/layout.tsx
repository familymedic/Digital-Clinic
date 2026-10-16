import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Find my appointment",
  description: "Booked without an account? Get back to your appointment with your mobile number and PIN.",
  robots: { index: false, follow: true },
};

export default function FindAppointmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
