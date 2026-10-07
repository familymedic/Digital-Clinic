"use client";

import { useEffect } from "react";
import { reportClientEvent } from "@/lib/telemetry";

// Same safety net as error.tsx, but for a crash in the ROOT layout
// itself (NavBar/Footer/AuthProvider/EmergencyBanner — the shell every
// page shares) rather than an individual page. This case is rare in
// practice but not impossible, and error.tsx alone can't catch it —
// Next.js requires a SEPARATE file for it, and because it replaces the
// root layout entirely when it fires, it has to render its own <html>
// and <body> (the ones in layout.tsx are gone at that point, not
// available to wrap this). Deliberately minimal, plain inline styles
// only — this is the one page in the app that can't assume Tailwind's
// build output or any other app code is safe to rely on.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root-layout error:", error);
    // Site-health (2026-10-07): a page that crashes outright is reported to Admin → Site health.
    reportClientEvent({ kind: "js_error", label: "page-crash", message: (error?.message ?? "").slice(0, 160) });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", color: "#0f1a19" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Family Medic is temporarily unavailable</h1>
          <p style={{ marginTop: "8px", maxWidth: "380px", fontSize: "14px", color: "#5b6a69", lineHeight: 1.6 }}>
            Something went wrong loading the site. Please try again in a moment.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: "20px",
              borderRadius: "999px",
              border: "none",
              background: "#0f5c53",
              color: "#fff",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
