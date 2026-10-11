// Shareable doctor card (2026-10-11). Draws a doctor's public details onto
// a <canvas> in the browser — nothing is generated or stored on the server,
// no third-party service is involved, and no new package is needed. The
// doctor decides when to download it and where to post it.
//
// Only facts already public on the doctor's own profile page are used: name,
// specialty, years of experience, approved credentials, photo. Deliberately
// NOT on the card: fee, reviews, outcomes or any claim. The footer always
// says the service is not for emergencies.

import { makeQr, type QrMatrix } from "@/lib/qr";

export type CardKind = "square" | "linkedin" | "story";

export const CARD_SIZES: Record<CardKind, { w: number; h: number; label: string; hint: string }> = {
  square: { w: 1080, h: 1080, label: "Square", hint: "Instagram & Facebook posts" },
  linkedin: { w: 1200, h: 627, label: "LinkedIn", hint: "LinkedIn posts" },
  story: { w: 1080, h: 1920, label: "Story", hint: "Instagram & Facebook stories, WhatsApp status" },
};

export const SITE_URL = "https://thefamilymedic.com";

export interface CardDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  years_of_experience: number | null;
  /** Approved credentials as stored in the public directory, e.g. "MBBS, RMP". */
  credentials: string | null;
  profile_photo_url: string | null;
}

export type CardPlatform = "qr" | "linkedin" | "instagram" | "facebook" | "story";

export function profileLink(doctorId: string, platform: CardPlatform): string {
  return `${SITE_URL}/doctors/${doctorId}?ref=card-${platform}`;
}

// ---------- text helpers ----------

/** "Dr" is added only if the stored name does not already start with it. */
export function displayName(fullName: string): string {
  const n = fullName.trim().replace(/\s+/g, " ");
  return /^dr\.?\s/i.test(n) ? n.replace(/^dr\.?\s/i, "Dr ") : `Dr ${n}`;
}

/** Split "A, B (x, y), C" on top-level commas only. */
export function splitCredentials(creds: string | null | undefined): string[] {
  if (!creds) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of creds) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function initialsOf(fullName: string): string {
  const parts = fullName.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "Dr";
}

export const MODES_LINE = "Text · Audio · Video consultations";

export function buildCaption(d: CardDoctor, platform: CardPlatform): string {
  const name = displayName(d.full_name);
  const bits = [d.specialty || "General Practice"];
  if (d.years_of_experience != null && d.years_of_experience > 0) bits.push(`${d.years_of_experience} years of experience`);
  const creds = splitCredentials(d.credentials);
  if (creds.length) bits.push(creds.join(", "));
  const link = profileLink(d.id, platform);
  const linkLine =
    platform === "instagram"
      ? `Book a consultation — link in my bio, or search “Family Medic”.\n${link}`
      : `Book a consultation: ${link}`;
  const tags = platform === "linkedin" ? "#FamilyMedic #OnlineDoctor #Telemedicine #Pakistan" : "#FamilyMedic #OnlineDoctor #Telemedicine #Pakistan #FamilyHealth";
  return [
    `I'm now available for online consultations on Family Medic — by text, audio or video, from wherever you are.`,
    ``,
    `${name} · ${bits.join(" · ")} · PMDC verified`,
    ``,
    linkLine,
    ``,
    `Not for emergencies. If it is urgent, please go to your nearest emergency department.`,
    ``,
    tags,
  ].join("\n");
}

// ---------- loading ----------

const FONT = '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Make sure the site font is ready before drawing (fails soft to system font). */
export async function loadCardFonts(): Promise<void> {
  try {
    if (typeof document === "undefined" || !document.fonts) return;
    await Promise.all(
      ["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "Plus Jakarta Sans"`)),
    );
  } catch {
    /* fall back to the system font */
  }
}

/**
 * Load the doctor's photo for the canvas. Returns null on any failure
 * (blocked, missing, no CORS) — the card then simply shows initials.
 */
export async function loadCardPhoto(url: string | null): Promise<ImageBitmap | HTMLImageElement | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  } catch {
    return null;
  }
}

// ---------- drawing ----------

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function font(ctx: Ctx, weight: number, px: number) {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

function textW(ctx: Ctx, text: string, weight: number, px: number): number {
  font(ctx, weight, px);
  return ctx.measureText(text).width;
}

function fitSize(ctx: Ctx, lines: string[], weight: number, start: number, min: number, maxW: number): number {
  let px = start;
  while (px > min && Math.max(...lines.map((l) => textW(ctx, l, weight, px))) > maxW) px -= 2;
  return px;
}

const TEAL_DARK = "#0a3733";
const TEAL = "#0f766e";
const AMBER = "#ffb454";
const AMBER_TEXT = "#3b2500";
const SOFT = "rgba(204,251,241,0.85)";

function background(ctx: Ctx, w: number, h: number, deco: [number, number, number][]) {
  const g = ctx.createRadialGradient(w * 0.85, -h * 0.1, 0, w * 0.85, -h * 0.1, Math.max(w, h) * 1.05);
  g.addColorStop(0, "#0f766e");
  g.addColorStop(0.45, "#0a3733");
  g.addColorStop(1, "#072927");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (const [cx, cy, r] of deco) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The Family Medic logo mark — the same white rounded tile with the teal
// outline heart used in the site header and footer (NavBar / Footer).
const HEART_PATH =
  "M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z";

function brand(ctx: Ctx, x: number, cy: number, logo: number, px: number) {
  rr(ctx, x, cy - logo / 2, logo, logo, logo * 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  const scale = (logo * 0.525) / 24;
  ctx.save();
  ctx.translate(x + (logo - 24 * scale) / 2, cy - logo / 2 + (logo - 24 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(HEART_PATH));
  ctx.restore();
  ctx.fillStyle = "#fff";
  font(ctx, 700, px);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("Family Medic", x + logo + px * 0.4, cy + px * 0.04);
  return x + logo + px * 0.4 + ctx.measureText("Family Medic").width;
}

function pill(ctx: Ctx, rightX: number, cy: number, text: string, px: number, padX: number, h: number) {
  const w = textW(ctx, text, 600, px) + padX * 2;
  rr(ctx, rightX - w, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = AMBER;
  ctx.fill();
  ctx.fillStyle = AMBER_TEXT;
  font(ctx, 600, px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rightX - w / 2, cy + px * 0.04);
  ctx.textAlign = "left";
  return w;
}

function pillCentered(ctx: Ctx, cx: number, cy: number, text: string, px: number, padX: number, h: number) {
  const w = textW(ctx, text, 600, px) + padX * 2;
  pill(ctx, cx + w / 2, cy, text, px, padX, h);
}

function photoCircle(
  ctx: Ctx,
  cx: number,
  cy: number,
  d: number,
  ring: number,
  photo: ImageBitmap | HTMLImageElement | null,
  initials: string,
) {
  const r = d / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = d * 0.18;
  ctx.shadowOffsetY = d * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = AMBER;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - ring, 0, Math.PI * 2);
  ctx.clip();
  if (photo) {
    const iw = (photo as ImageBitmap).width;
    const ih = (photo as ImageBitmap).height;
    const side = Math.min(iw, ih);
    const sx = (iw - side) / 2;
    const sy = Math.max(0, (ih - side) * 0.2);
    ctx.drawImage(photo, sx, sy, side, side, cx - r + ring, cy - r + ring, d - ring * 2, d - ring * 2);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#d9f3ea");
    g.addColorStop(1, "#9fd8c9");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, d, d);
    ctx.fillStyle = TEAL_DARK;
    font(ctx, 700, d * 0.36);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, cx, cy + d * 0.015);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

/** Draws chips left-to-right from x; drops trailing credentials that do not fit. Returns nothing. */
function chipRow(ctx: Ctx, x: number, cy: number, maxW: number, px: number, h: number, gap: number, creds: string[]) {
  const padX = px * 0.95;
  const verifiedLabel = "PMDC verified";
  const checkW = px * 1.15;
  const verifiedW = textW(ctx, verifiedLabel, 600, px) + padX * 2 + checkW;
  const clean = creds.map((c) => (c.length > 24 ? c.slice(0, 23) + "…" : c)).slice(0, 4);
  const widths = clean.map((c) => textW(ctx, c, 600, px) + padX * 2);
  let used = verifiedW;
  const keep: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (used + gap + widths[i] <= maxW) {
      keep.push(i);
      used += gap + widths[i];
    }
  }
  let cx = x;
  for (const i of keep) {
    rr(ctx, cx, cy - h / 2, widths[i], h, h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    font(ctx, 600, px);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(clean[i], cx + padX, cy + px * 0.04);
    cx += widths[i] + gap;
  }
  rr(ctx, cx, cy - h / 2, verifiedW, h, h / 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = px * 0.11;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const kx = cx + padX;
  ctx.beginPath();
  ctx.moveTo(kx, cy + px * 0.02);
  ctx.lineTo(kx + px * 0.28, cy + px * 0.3);
  ctx.lineTo(kx + px * 0.74, cy - px * 0.28);
  ctx.stroke();
  ctx.fillStyle = TEAL;
  font(ctx, 600, px);
  ctx.textBaseline = "middle";
  ctx.fillText(verifiedLabel, cx + padX + checkW, cy + px * 0.04);
}

function drawQr(ctx: Ctx, qr: QrMatrix | null, x: number, y: number, slot: number) {
  if (!qr) return;
  const m = Math.max(1, Math.floor(slot / qr.size));
  const total = m * qr.size;
  const ox = x + Math.floor((slot - total) / 2);
  const oy = y + Math.floor((slot - total) / 2);
  ctx.fillStyle = TEAL_DARK;
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) ctx.fillRect(ox + c * m, oy + r * m, m, m);
    }
  }
}

function button(ctx: Ctx, x: number, y: number, h: number, text: string, px: number, padX: number) {
  const w = textW(ctx, text, 700, px) + padX * 2;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = AMBER;
  ctx.fill();
  ctx.fillStyle = AMBER_TEXT;
  font(ctx, 700, px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + px * 0.04);
  ctx.textAlign = "left";
  return w;
}

function whiteCard(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(7,41,39,0.55)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
}

function nameLines(fullName: string, joinOneLine: boolean): string[] {
  const dn = displayName(fullName);
  const words = dn.split(" ");
  if (joinOneLine || words.length <= 2) return [dn];
  return [`${words[0]} ${words[1]}`, words.slice(2).join(" ")];
}

export interface CardRender {
  doctor: CardDoctor;
  photo: ImageBitmap | HTMLImageElement | null;
}

/** Draw the card of the given kind onto the canvas (canvas is resized to the card size). */
export function drawDoctorCard(canvas: HTMLCanvasElement, kind: CardKind, input: CardRender): void {
  const { w, h } = CARD_SIZES[kind];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const d = input.doctor;
  const creds = splitCredentials(d.credentials);
  const specialty = d.specialty || "General Practice";
  const years = d.years_of_experience != null && d.years_of_experience > 0 ? `${d.years_of_experience} years of experience` : null;
  const initials = initialsOf(d.full_name);
  let qr: QrMatrix | null = null;
  try {
    qr = makeQr(profileLink(d.id, "qr"));
  } catch {
    qr = null;
  }
  const PILL = "Available online";
  const CTA = "Book a consultation";

  if (kind === "square") {
    const pad = 64;
    background(ctx, w, h, [
      [w + 90, 70, 310],
      [30, 700, 190],
    ]);
    const bEnd = brand(ctx, pad, 95, 52, 36);
    void bEnd;
    pill(ctx, w - pad, 95, PILL, 26, 26, 62);

    photoCircle(ctx, pad + 150, 340, 300, 10, input.photo, initials);
    const tx = pad + 300 + 48;
    const lines = nameLines(d.full_name, false);
    const px = fitSize(ctx, lines, 700, 78, 44, w - pad - tx);
    ctx.fillStyle = AMBER;
    font(ctx, 500, 30);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Consult online with", tx, 268);
    ctx.fillStyle = "#fff";
    font(ctx, 700, px);
    const lh = px * 1.0;
    const startY = lines.length === 1 ? 358 : 358 - (lines.length === 2 ? 0 : 0);
    lines.forEach((l, i) => ctx.fillText(l, tx, startY + i * lh));

    ctx.fillStyle = "#fff";
    font(ctx, 600, 36);
    ctx.textBaseline = "middle";
    ctx.fillText(specialty, pad, 562);
    let nextY = 562;
    if (years) {
      ctx.fillStyle = SOFT;
      font(ctx, 400, 28);
      ctx.fillText(years, pad, 612);
      nextY = 612;
    }
    chipRow(ctx, pad, nextY + 74, w - pad * 2, 26, 56, 16, creds);

    whiteCard(ctx, pad, 740, w - pad * 2, 232, 36);
    const bx = pad + 44;
    const bw = button(ctx, bx, 776, 76, CTA, 30, 38);
    void bw;
    ctx.fillStyle = "#4f6a67";
    font(ctx, 500, 22);
    ctx.textBaseline = "middle";
    ctx.fillText(MODES_LINE, bx, 886);
    ctx.fillStyle = TEAL;
    font(ctx, 700, 28);
    ctx.fillText("thefamilymedic.com", bx, 926);
    drawQr(ctx, qr, w - pad - 36 - 164, 740 + 34, 164);

    ctx.fillStyle = SOFT;
    font(ctx, 400, 20);
    ctx.textAlign = "center";
    ctx.fillText("Verified doctors · Not for emergencies", w / 2, 1010);
    ctx.textAlign = "left";
    return;
  }

  if (kind === "linkedin") {
    const padX = 56;
    background(ctx, w, h, [[w + 20, 60, 260]]);
    brand(ctx, padX, 72, 46, 30);
    pill(ctx, w - padX, 72, PILL, 22, 22, 48);

    photoCircle(ctx, padX + 125, 290, 250, 8, input.photo, initials);
    const tx = padX + 250 + 48;
    const lines = nameLines(d.full_name, true);
    const px = fitSize(ctx, lines, 700, 64, 36, w - padX - tx);
    ctx.fillStyle = "#fff";
    font(ctx, 700, px);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(lines[0], tx, 232);
    font(ctx, 600, 30);
    ctx.textBaseline = "middle";
    ctx.fillText(specialty, tx, 278);
    let nextY = 278;
    if (years) {
      ctx.fillStyle = SOFT;
      font(ctx, 400, 22);
      ctx.fillText(years, tx, 322);
      nextY = 322;
    }
    chipRow(ctx, tx, nextY + 58, w - padX - tx, 21, 46, 12, creds);

    whiteCard(ctx, padX, 450, w - padX * 2, 132, 28);
    const bx = padX + 34;
    const bw = button(ctx, bx, 450 + 36, 60, CTA, 24, 28);
    const mx = bx + bw + 28;
    ctx.fillStyle = "#4f6a67";
    font(ctx, 500, 19);
    ctx.textBaseline = "middle";
    ctx.fillText(MODES_LINE, mx, 450 + 44);
    ctx.fillStyle = TEAL;
    font(ctx, 700, 26);
    ctx.fillText("thefamilymedic.com", mx, 450 + 82);
    const qrSlot = 96;
    const qx = w - padX - 24 - qrSlot;
    drawQr(ctx, qr, qx, 450 + 18, qrSlot);
    ctx.fillStyle = "#4f6a67";
    font(ctx, 400, 15);
    ctx.textAlign = "right";
    ctx.fillText("Not for", qx - 18, 450 + 56);
    ctx.fillText("emergencies", qx - 18, 450 + 76);
    ctx.textAlign = "left";
    return;
  }

  // story
  const pad = 72;
  background(ctx, w, h, [
    [w + 80, 120, 380],
    [-30, 1200, 260],
  ]);
  ctx.textAlign = "left";
  const bw = textW(ctx, "Family Medic", 700, 42) + 52 + 17;
  brand(ctx, (w - bw) / 2, 122, 52, 42);
  pillCentered(ctx, w / 2, 232, PILL, 30, 30, 70);

  photoCircle(ctx, w / 2, 524, 400, 12, input.photo, initials);
  ctx.textAlign = "center";
  ctx.fillStyle = AMBER;
  font(ctx, 500, 32);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Consult online with", w / 2, 790);
  const lines = nameLines(d.full_name, false);
  const px = fitSize(ctx, lines, 700, 96, 52, w - pad * 2);
  ctx.fillStyle = "#fff";
  font(ctx, 700, px);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, 900 + px * 0.2 + i * px * 1.02));
  const afterName = 900 + px * 0.2 + (lines.length - 1) * px * 1.02;
  ctx.textBaseline = "middle";
  font(ctx, 600, 42);
  ctx.fillText(specialty, w / 2, afterName + 80);
  let chipY = afterName + 80 + 82;
  if (years) {
    ctx.fillStyle = SOFT;
    font(ctx, 400, 32);
    ctx.fillText(years, w / 2, afterName + 142);
    chipY = afterName + 142 + 84;
  }
  // centre the chip row: measure by drawing offscreen width first
  ctx.textAlign = "left";
  const rowW = chipRowWidth(ctx, 30, 16, creds, w - pad * 2);
  chipRow(ctx, (w - rowW) / 2, chipY, w - pad * 2, 30, 66, 16, creds);

  const cardY = 1326;
  whiteCard(ctx, pad, cardY, w - pad * 2, 476, 40);
  const ctaText = CTA;
  const ctaW = textW(ctx, ctaText, 700, 36) + 96;
  button(ctx, (w - ctaW) / 2, cardY + 36, 92, ctaText, 36, 48);
  ctx.textAlign = "center";
  ctx.fillStyle = "#4f6a67";
  font(ctx, 500, 26);
  ctx.textBaseline = "middle";
  ctx.fillText(MODES_LINE, w / 2, cardY + 36 + 92 + 34);
  drawQr(ctx, qr, (w - 200) / 2, cardY + 36 + 92 + 66, 200);
  ctx.fillStyle = TEAL;
  font(ctx, 700, 30);
  ctx.fillText("thefamilymedic.com", w / 2, cardY + 476 - 36);
  ctx.fillStyle = SOFT;
  font(ctx, 400, 24);
  ctx.fillText("Verified doctors · Not for emergencies", w / 2, 1850);
  ctx.textAlign = "left";
}

function chipRowWidth(ctx: Ctx, px: number, gap: number, creds: string[], maxW: number): number {
  const padX = px * 0.95;
  const verifiedW = textW(ctx, "PMDC verified", 600, px) + padX * 2 + px * 1.15;
  const clean = creds.map((c) => (c.length > 24 ? c.slice(0, 23) + "…" : c)).slice(0, 4);
  let used = verifiedW;
  for (const c of clean) {
    const wc = textW(ctx, c, 600, px) + padX * 2;
    if (used + gap + wc <= maxW) used += gap + wc;
  }
  return used;
}
