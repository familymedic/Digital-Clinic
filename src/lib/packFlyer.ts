// Doctor Family Pack flyer (2026-10-26). Draws the flyer on a <canvas> in the
// doctor's own browser from (a) the doctor's public directory facts and (b) the
// doctor's own live pack terms. Nothing is generated or stored on the server,
// no third-party service is used. It reuses the drawing helpers and QR maker
// of the "Share my card" feature.
//
// By design the flyer shows NO price: the price is on the doctor's page after
// the QR code is scanned, so a printed flyer can never show a stale or
// different price. It uses only the facts the doctor already shows publicly
// plus the pack terms an admin approved, never an outcome claim, and always
// carries "Not for emergencies".

import { makeQr, type QrMatrix } from "@/lib/qr";
import {
  AMBER,
  AMBER_TEXT,
  SITE_URL,
  TEAL,
  TEAL_DARK,
  background,
  brand,
  displayName,
  drawQr,
  font,
  initialsOf,
  photoCircle,
  pill,
  rr,
  splitCredentials,
  textW,
  type CardDoctor,
  type Ctx,
} from "@/lib/doctorCard";

export type FlyerKind = "feed" | "story" | "print";

export const FLYER_SIZES: Record<FlyerKind, { w: number; h: number; label: string; hint: string }> = {
  feed: { w: 1080, h: 1350, label: "Feed post", hint: "Instagram, Facebook and WhatsApp posts" },
  story: { w: 1080, h: 1920, label: "Story / WhatsApp status", hint: "Tall image for stories and status" },
  print: { w: 2480, h: 3508, label: "Print (A4)", hint: "Clinic wall or print shop, A4 at 300 dpi" },
};

export interface FlyerPack {
  consultations_total: number;
  members_allowed: number;
  allow_text: boolean;
  allow_audio: boolean;
  allow_video: boolean;
  validity_days: number;
  reply_window_hours: number;
}

/** The link in the QR code: the doctor's page, with their personal pack code, jumping to the pack. */
export function packFlyerLink(doctorId: string, code: string): string {
  return `${SITE_URL}/doctors/${doctorId}?pack=${encodeURIComponent(code)}&ref=flyer#family-pack`;
}

export function packWays(p: Pick<FlyerPack, "allow_text" | "allow_audio" | "allow_video">): string[] {
  const ways: string[] = [];
  if (p.allow_text) ways.push("Text & voice notes");
  if (p.allow_audio) ways.push("Audio calls");
  if (p.allow_video) ways.push("Video calls");
  return ways;
}

export function consultationsLabel(n: number): string {
  return `${n} consultation${n === 1 ? "" : "s"}`;
}

export function membersLabel(m: number): string {
  return m > 1 ? `Up to ${m} family members` : "1 family member";
}

export function buildFlyerCaption(d: CardDoctor, p: FlyerPack, link: string): string {
  const name = displayName(d.full_name);
  const ways = packWays(p).join(", ").toLowerCase();
  return [
    `My Family Pack is open on Family Medic: one doctor for your whole family, without booking every single time.`,
    ``,
    `${consultationsLabel(p.consultations_total)} over ${p.validity_days} days, ${membersLabel(p.members_allowed).toLowerCase()}, ${ways}. Pay once, no auto-renewal. The price and full details are on my page.`,
    ``,
    `${name} · ${d.specialty || "General Practice"} · PMDC verified`,
    ``,
    `See my pack: ${link}`,
    ``,
    `Not for emergencies. If it is urgent, please go to your nearest emergency department.`,
    ``,
    `#FamilyMedic #FamilyDoctor #Telemedicine #Pakistan #FamilyHealth`,
  ].join("\n");
}

// ---------- drawing ----------

function wrap(ctx: Ctx, text: string, weight: number, px: number, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && textW(ctx, t, weight, px) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fit(ctx: Ctx, text: string, weight: number, start: number, min: number, maxW: number): number {
  let px = start;
  while (px > min && textW(ctx, text, weight, px) > maxW) px -= 2;
  return px;
}

function trunc(ctx: Ctx, text: string, weight: number, px: number, maxW: number): string {
  if (textW(ctx, text, weight, px) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textW(ctx, `${t}…`, weight, px) > maxW) t = t.slice(0, -1);
  return `${t.trim()}…`;
}

function txt(ctx: Ctx, s: string, x: number, y: number, weight: number, px: number, color: string, align: CanvasTextAlign = "left") {
  font(ctx, weight, px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
  ctx.textAlign = "left";
}

function card(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(7,41,39,0.5)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 12;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
}

function tick(ctx: Ctx, cx: number, cy: number, d: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#14b8a6";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = d * 0.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - d * 0.2, cy + d * 0.01);
  ctx.lineTo(cx - d * 0.05, cy + d * 0.16);
  ctx.lineTo(cx + d * 0.22, cy - d * 0.14);
  ctx.stroke();
}

export interface FlyerRender {
  doctor: CardDoctor;
  pack: FlyerPack;
  photo: ImageBitmap | HTMLImageElement | null;
  /** The doctor's personal pack code (goes into the QR link). */
  code: string;
}

export function drawPackFlyer(canvas: HTMLCanvasElement, kind: FlyerKind, input: FlyerRender): void {
  const size = FLYER_SIZES[kind];
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size.w, size.h);

  // Everything below is laid out on a 1080-wide page; the A4 print size is the same page scaled up.
  const k = size.w / 1080;
  const W = 1080;
  const H = size.h / k;
  ctx.save();
  ctx.scale(k, k);

  const story = H > 1700;
  const tall = H > 1500; // story and A4 get the three tick lines
  const { doctor: d, pack: p } = input;
  const PAD = 62;
  const INNER = W - PAD * 2;

  background(ctx, W, H, [
    [W + 90, 70, 310],
    [30, H * 0.55, 190],
  ]);

  // header
  const headCy = story ? 112 : 86;
  brand(ctx, PAD, headCy, 64, 32);
  ctx.textAlign = "left";
  pill(ctx, W - PAD, headCy, "FAMILY PACK", 23, 26, 52);

  // doctor block
  const dia = story ? 280 : 250;
  const photoTop = headCy + 32 + (story ? 70 : 40);
  const pcx = PAD + dia / 2;
  const pcy = photoTop + dia / 2;
  photoCircle(ctx, pcx, pcy, dia, 10, input.photo, initialsOf(d.full_name));
  const tx = PAD + dia + 34;
  const tw = W - PAD - tx;
  const name = displayName(d.full_name);
  const nameSize = fit(ctx, name, 800, 60, 36, tw);
  const bits = [d.specialty || "General Practice"];
  if (d.years_of_experience != null && d.years_of_experience > 0) bits.push(`${d.years_of_experience} years`);
  const spec = trunc(ctx, bits.join(" · "), 700, 30, tw);
  const credsRaw = splitCredentials(d.credentials).join(", ");
  const creds = credsRaw ? trunc(ctx, credsRaw, 700, 27, tw) : "";
  const blockH = nameSize + 12 + 34 + (creds ? 36 : 0) + 16 + 46;
  let y = pcy - blockH / 2;
  txt(ctx, name, tx, y, 800, nameSize, "#fff");
  y += nameSize + 12;
  txt(ctx, spec, tx, y, 700, 30, "#ffd08a");
  y += 34;
  if (creds) {
    txt(ctx, creds, tx, y, 700, 27, "rgba(255,255,255,0.9)");
    y += 36;
  }
  y += 16;
  // PMDC verified chip
  const vlabel = "PMDC verified";
  const vw = textW(ctx, vlabel, 800, 23) + 44 + 28;
  rr(ctx, tx, y, vw, 46, 23);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(tx + 18, y + 24);
  ctx.lineTo(tx + 26, y + 32);
  ctx.lineTo(tx + 40, y + 15);
  ctx.stroke();
  txt(ctx, vlabel, tx + 54, y + 10, 800, 23, "#fff");

  // headline
  const photoBottom = photoTop + dia;
  let hy = photoBottom + (story ? 64 : 36);
  txt(ctx, "My Family Pack.", PAD, hy, 800, 70, "#fff");
  hy += 74;
  txt(ctx, "One doctor for your family.", PAD, hy, 800, 70, AMBER);
  hy += 74;

  // pack card
  const cardPad = story ? 40 : 30;
  const cy0 = hy + (story ? 44 : 28);
  const ways = packWays(p);
  const innerX = PAD + 42;
  const innerW = INNER - 84;
  // chips measured first so the card knows its height
  const chipPx = 25;
  const chipH = 50;
  const chipGap = 10;
  const chipRows: string[][] = [[]];
  let rowW = 0;
  for (const w of ways) {
    const cw = textW(ctx, w, 800, chipPx) + 44;
    if (rowW + cw > innerW && chipRows[chipRows.length - 1].length) {
      chipRows.push([]);
      rowW = 0;
    }
    chipRows[chipRows.length - 1].push(w);
    rowW += cw + chipGap;
  }
  const foot = `Pay once, no auto-renewal. Price is on my page. Replies within ${p.reply_window_hours}h.`;
  const footLines = wrap(ctx, foot, 700, 25, innerW);
  const mainH = story ? 118 : 108;
  const cardH =
    cardPad + mainH + 20 + chipRows.length * (chipH + chipGap) + 4 + footLines.length * 32 + cardPad - 4;
  card(ctx, PAD, cy0, INNER, cardH, 38);
  let cy = cy0 + cardPad;
  const bigPx = story ? 56 : 48;
  txt(ctx, consultationsLabel(p.consultations_total), innerX, cy + 8, 800, bigPx, TEAL_DARK);
  txt(ctx, membersLabel(p.members_allowed), innerX, cy + 8 + bigPx + 12, 700, 28, TEAL);
  const daysPx = story ? 110 : 96;
  txt(ctx, String(p.validity_days), PAD + INNER - 42, cy - 8, 800, daysPx, TEAL, "right");
  txt(ctx, "days of care", PAD + INNER - 42, cy - 8 + daysPx + 2, 800, story ? 34 : 30, TEAL, "right");
  cy += mainH + 20;
  for (const row of chipRows) {
    let cx = innerX;
    for (const w of row) {
      const cw = textW(ctx, w, 800, chipPx) + 44;
      rr(ctx, cx, cy, cw, chipH, chipH / 2);
      ctx.fillStyle = "#e6f6f2";
      ctx.fill();
      txt(ctx, w, cx + 22, cy + 11, 800, chipPx, TEAL);
      cx += cw + chipGap;
    }
    cy += chipH + chipGap;
  }
  cy += 4;
  for (const l of footLines) {
    txt(ctx, l, innerX, cy, 700, 25, "#486b66");
    cy += 32;
  }
  const cardBottom = cy0 + cardH;

  // bottom block: QR card + small print
  // The QR is built first so its squares are a whole number of pixels (4 on the feed, 5 on the
  // tall story) and stay easy to scan from a phone screen.
  let qr: QrMatrix | null = null;
  try {
    qr = makeQr(packFlyerLink(d.id, input.code));
  } catch {
    qr = null;
  }
  const qrSlot = qr ? qr.size * (story ? 5 : 4) : story ? 190 : 168;
  const qrCardH = qrSlot + 48;
  const small = "Latest terms are shown on the page after you scan. Not for emergencies: call 1122 or go to the nearest hospital.";
  const smallLines = wrap(ctx, small, 600, 22, INNER);
  const bottomPad = story ? 90 : 42;
  const smallH = smallLines.length * 29;
  const qrY = H - bottomPad - smallH - 16 - qrCardH;

  if (tall) {
    // three tick lines between the pack card and the QR card
    const rows = ["One doctor who gets to know your family", "Message anytime. No booking every time.", "Pay once. No auto-renewal."];
    const rh = story ? 100 : 56;
    const gap = story ? 20 : 12;
    const rpx = story ? 32 : 28;
    let ry = cardBottom + (story ? 20 : 12);
    for (const r of rows) {
      if (ry + rh > qrY - 8) break;
      rr(ctx, PAD, ry, INNER, rh, 28);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();
      tick(ctx, PAD + 30 + 24, ry + rh / 2, 48);
      txt(ctx, r, PAD + 30 + 48 + 20, ry + rh / 2 - rpx * 0.55, 700, rpx, "#fff");
      ry += rh + gap;
    }
  }

  card(ctx, PAD, qrY, INNER, qrCardH, 38);
  drawQr(ctx, qr, PAD + 30, qrY + 24, qrSlot);
  const bx = PAD + 30 + qrSlot + 30;
  const bw = PAD + INNER - 30 - bx;
  const bh = 82;
  const by = qrY + qrCardH / 2 - bh / 2 - 22;
  rr(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = AMBER;
  ctx.fill();
  txt(ctx, "Scan to see my pack", bx + bw / 2, by + 20, 800, 36, AMBER_TEXT, "center");
  txt(ctx, "thefamilymedic.com", bx + bw / 2, by + bh + 16, 800, 30, TEAL_DARK, "center");

  let sy = qrY + qrCardH + 16;
  for (const l of smallLines) {
    txt(ctx, l, W / 2, sy, 600, 22, "rgba(255,255,255,0.85)", "center");
    sy += 29;
  }

  ctx.restore();
}
