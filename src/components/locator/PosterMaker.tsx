"use client";

import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";

// A share poster for a listed workplace (or the plain "list your workplace" invitation), drawn
// in the browser: nothing is uploaded. The QR code opens the Family Medic Locator.
// Used on the owner's page and in the admin screen.

const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SITE = "https://thefamilymedic.com";

type Size = "post" | "story";
const SIZES: Record<Size, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: "Post (1080×1350)" },
  story: { w: 1080, h: 1920, label: "Story / status (1080×1920)" },
};

export interface PosterProps {
  mode?: "place" | "invite";
  name?: string;
  kindLabel?: string;
  area?: string;
  verified?: boolean;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s+\S*$/, "") + "…";
    return cut;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawPoster(canvas: HTMLCanvasElement, size: Size, p: PosterProps) {
  const { w, h } = SIZES[size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const tall = size === "story";

  // background
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0a3733");
  g.addColorStop(1, "#072927");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.92, 0, 10, w * 0.92, 0, w * 0.8);
  glow.addColorStop(0, "rgba(45,212,191,0.35)");
  glow.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // radar rings
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  for (const r of [200, 330, 470]) {
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.1, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const pad = 80;
  let y = tall ? 170 : 110;

  ctx.fillStyle = "#ffb454";
  roundRect(ctx, pad, y, 70, 12, 6);
  ctx.fill();
  y += 70;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText("Family Medic", pad, y);
  y += tall ? 110 : 80;

  ctx.fillStyle = "#c9ece5";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(p.mode === "invite" ? "FAMILY MEDIC LOCATOR · KARACHI" : "FIND US ON THE FAMILY MEDIC LOCATOR", pad, y);
  y += tall ? 100 : 80;

  if (p.mode === "invite") {
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 86px ${FONT}`;
    for (const l of ["Is your clinic,", "pharmacy or therapy", "centre easy to find?"]) {
      ctx.fillText(l, pad, y);
      y += 100;
    }
    ctx.fillStyle = "#ffb454";
    ctx.font = `800 46px ${FONT}`;
    y += 20;
    for (const l of wrap(ctx, "List it on the Locator. Families near you will find you in one tap.", w - pad * 2, 3)) {
      ctx.fillText(l, pad, y);
      y += 62;
    }
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 92px ${FONT}`;
    for (const l of wrap(ctx, p.name || "Your workplace", w - pad * 2, 3)) {
      ctx.fillText(l, pad, y);
      y += 106;
    }
    y += 6;
    ctx.fillStyle = "#ffb454";
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText([p.kindLabel, p.area].filter(Boolean).join(" · "), pad, y);
    y += 70;
    if (p.verified) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      roundRect(ctx, pad, y - 44, 640, 66, 33);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText("✓ Documents checked by Family Medic", pad + 28, y);
      y += 70;
    }
  }

  // QR card
  const card = tall ? 640 : 560;
  const cx = (w - card) / 2;
  const cy = Math.max(y + 40, h - card - (tall ? 380 : 240));
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cx, cy, card, card, 44);
  ctx.fill();
  try {
    const qr = qrcode(0, "M");
    qr.addData(`${SITE}/locator`);
    qr.make();
    const n = qr.getModuleCount();
    const inner = card - 90;
    const cell = Math.floor(inner / n);
    const used = cell * n;
    const ox = cx + (card - used) / 2;
    const oy = cy + (card - used) / 2;
    ctx.fillStyle = "#072927";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
  } catch {
    // if the QR fails the URL below still carries the message
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 48px ${FONT}`;
  const capY = cy + card + 80;
  ctx.fillText("Scan to find us near you", w / 2, capY);
  ctx.fillStyle = "#c9ece5";
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText("Doctors · Clinics · Therapy & Rehab · Autism-Aware Places", w / 2, capY + 58);
  ctx.fillStyle = "#ffb454";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText("thefamilymedic.com/locator", w / 2, capY + 126);
  ctx.textAlign = "left";
}

export default function PosterMaker(props: PosterProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<Size>("post");

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawPoster(c, size, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, props.mode, props.name, props.kindLabel, props.area, props.verified]);

  function download() {
    const c = ref.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = (props.mode === "invite" ? "family-medic-locator-invite" : `family-medic-${props.name ?? "poster"}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      a.download = `${slug}-${size}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }

  return (
    <div data-testid="poster-maker">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Poster size">
        {(Object.keys(SIZES) as Size[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            aria-pressed={size === s}
            className={`min-h-10 rounded-full border px-4 text-xs font-extrabold ${
              size === s ? "border-teal-700 bg-teal-50 text-teal-800" : "border-[#d7e7e2] bg-white text-ink-700"
            }`}
          >
            {SIZES[s].label}
          </button>
        ))}
      </div>
      <canvas ref={ref} className="mt-3 w-full max-w-[320px] rounded-2xl border border-[#d7e7e2]" aria-label="Poster preview" />
      <div className="mt-3">
        <button
          type="button"
          onClick={download}
          data-testid="poster-download"
          className="min-h-11 rounded-full bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800"
        >
          Download poster (PNG)
        </button>
        <p className="mt-2 text-xs text-ink-500">Print it for your door or counter, or share it on WhatsApp, Facebook and Instagram.</p>
      </div>
    </div>
  );
}
