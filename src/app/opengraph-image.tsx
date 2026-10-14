import { ImageResponse } from "next/og";

// Default social-share card (1200x630) used when a link to the site is
// pasted into WhatsApp / Facebook / LinkedIn / X. Generated in code — no
// image file, no cost. Colors match the brand (teal → deep green).
export const alt = "Family Medic — a family doctor who knows your family";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #14b8a6 0%, #0f5c53 100%)",
          color: "white",
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 600, opacity: 0.9 }}>Family Medic</div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05, marginTop: 24 }}>
          A family doctor who knows your family
        </div>
        <div style={{ fontSize: 34, marginTop: 36, opacity: 0.92 }}>
          Online consultations with PMDC-verified doctors — one account for everyone you care for
        </div>
      </div>
    ),
    { ...size },
  );
}
