// Habit Age share cards. Drawn on a <canvas> in the player's browser: nothing
// is generated or stored on the server and no extra package or service is
// involved. The player decides when to download or share the picture.
//
// Cards never claim anything medical. The footer always says the quiz is for
// fun and not a medical assessment.

import { SITE_URL } from "@/lib/site";
import { weekLabel } from "@/lib/habitAge";

const FONT = '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const W = 1080;
const H = 1350;

export interface PersonalCardInput {
  habitAge: number;
  realAge: number;
  score: number;
  /** "Gujrat, Punjab" or null when the player did not pick a city */
  cityLabel: string | null;
  cityName: string | null;
  /** City average score, only when the league shows one for this city */
  cityAvg: number | null;
}

export interface WinnerCardInput {
  weekStart: string;
  best?: { name: string; province: string; score: number };
  improved?: { name: string; province: string; delta: number };
}

async function loadFonts(): Promise<void> {
  try {
    if (typeof document === "undefined" || !document.fonts) return;
    await Promise.all(["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "Plus Jakarta Sans"`)));
  } catch {
    // fall back to the system font
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, min = 24): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && s > min) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

function background(ctx: CanvasRenderingContext2D, accent: "teal" | "amber") {
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, "#0b4540");
  g.addColorStop(1, "#072927");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W * 0.85, H * 0.06, 0, W * 0.85, H * 0.06, 560);
  r.addColorStop(0, accent === "teal" ? "rgba(45,212,191,0.30)" : "rgba(255,180,84,0.25)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function brand(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 70, 70, 64, 64, 16);
  ctx.fill();
  // heart mark
  ctx.save();
  ctx.translate(70 + (64 * 3.4) / 24, 70 + (64 * 3.4) / 24);
  ctx.scale(1.912, 1.912);
  const heart = new Path2D("M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z");
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.stroke(heart);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 36px ${FONT}`;
  ctx.fillText("Family Medic", 150, 106);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `700 15px ${FONT}`;
  // letter-spaced label
  let x = 150;
  for (const ch of "HABIT AGE") {
    ctx.fillText(ch, x, 126);
    x += ctx.measureText(ch).width + 3.4;
  }
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, fraction: number, big: string, label: string) {
  ctx.lineWidth = 28;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  const f = Math.max(0.04, Math.min(1, fraction));
  ctx.strokeStyle = "#ffb454";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 210px ${FONT}`;
  ctx.fillText(big, cx, cy + 62);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `700 32px ${FONT}`;
  let text = "";
  for (const ch of label) text += ch + " ";
  ctx.fillText(text.trim(), cx, cy + 128);
}

function footer(ctx: CanvasRenderingContext2D, cta: string, y: number) {
  ctx.font = `800 50px ${FONT}`;
  const w = Math.max(ctx.measureText(cta).width + 110, 380);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, (W - w) / 2, y, w, 100, 50);
  ctx.fill();
  ctx.fillStyle = "#0a3733";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cta, W / 2, y + 52);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `600 27px ${FONT}`;
  ctx.fillText(SITE_URL.replace(/^https?:\/\//, ""), W / 2, y + 146);
  ctx.font = `500 25px ${FONT}`;
  ctx.fillText("For fun, not a medical assessment. Not for emergencies.", W / 2, y + 182);
}

export async function drawPersonalCard(canvas: HTMLCanvasElement, input: PersonalCardInput): Promise<void> {
  await loadFonts();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  background(ctx, "teal");
  brand(ctx);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText("My Habit Age", W / 2, 262);

  ring(ctx, W / 2, 490, 184, input.score / 100, String(input.habitAge), "HABIT AGE");

  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(`Real age ${input.realAge} · just for fun`, W / 2, 758);

  let y = 790;
  if (input.cityLabel) {
    const size = fit(ctx, input.cityLabel, 800, 40, 760, 28);
    ctx.font = `800 ${size}px ${FONT}`;
    const w = ctx.measureText(input.cityLabel).width + 76;
    ctx.fillStyle = "#ffb454";
    roundRect(ctx, (W - w) / 2, y, w, 64, 32);
    ctx.fill();
    ctx.fillStyle = "#3b2500";
    ctx.textBaseline = "middle";
    ctx.fillText(input.cityLabel, W / 2, y + 34);
    ctx.textBaseline = "alphabetic";
    y += 88;
  }
  if (input.cityName && input.cityAvg !== null) {
    const line = `${input.cityName} average: ${input.cityAvg} · my score: ${input.score}`;
    const size = fit(ctx, line, 700, 34, 780, 22);
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(line).width + 68;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, (W - w) / 2, y, w, 76, 24);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(line, W / 2, y + 40);
    ctx.textBaseline = "alphabetic";
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(`My Habit Score: ${input.score}`, W / 2, y + 30);
  }

  footer(ctx, "Beat my score!", 1060);
}

export async function drawWinnerCard(canvas: HTMLCanvasElement, input: WinnerCardInput): Promise<void> {
  await loadFonts();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  background(ctx, "amber");
  brand(ctx);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // pill
  ctx.font = `800 28px ${FONT}`;
  const pill = `WEEK OF ${weekLabel(input.weekStart).split(" to ")[0].toUpperCase()}`;
  const pw = ctx.measureText(pill).width + 56;
  ctx.fillStyle = "#ffb454";
  roundRect(ctx, 70, 200, pw, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#3b2500";
  ctx.textBaseline = "middle";
  ctx.fillText(pill, 98, 229);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 88px ${FONT}`;
  ctx.fillText("City of the", 70, 372);
  ctx.fillStyle = "#ffb454";
  ctx.fillText("Week", 70, 466);

  let y = 540;
  const block = (label: string, name: string, sub: string) => {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 70, y, W - 140, 190, 38);
    ctx.fill();
    ctx.fillStyle = "#ffb454";
    ctx.beginPath();
    ctx.arc(70 + 36 + 55, y + 95, 55, 0, Math.PI * 2);
    ctx.fill();
    // trophy dot mark
    ctx.fillStyle = "#3b2500";
    ctx.font = `800 54px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", 70 + 36 + 55, y + 98);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#0f766e";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(label, 70 + 36 + 110 + 30, y + 62);
    const maxW = W - 140 - 36 - 110 - 30 - 36;
    const size = fit(ctx, name, 800, 58, maxW, 30);
    ctx.fillStyle = "#0a3733";
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillText(name, 70 + 36 + 110 + 30, y + 118);
    ctx.fillStyle = "#33615a";
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(sub, 70 + 36 + 110 + 30, y + 160);
    y += 218;
  };
  if (input.best) block("BEST HABITS THIS WEEK", input.best.name, `${input.best.province} · average score ${input.best.score}`);
  if (input.improved)
    block("MOST IMPROVED", input.improved.name, `${input.improved.province} · up ${input.improved.delta} points`);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("Is your city next?", 70, Math.max(y + 40, 1010));

  footer(ctx, "Play Habit Age", 1060);
}

export function cardToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Share the card picture with the phone's share sheet when the phone allows
 * it, otherwise download it. Returns what happened so the page can tell the
 * player. Never throws.
 */
export async function shareOrDownloadCard(
  canvas: HTMLCanvasElement,
  fileName: string,
  text: string
): Promise<"shared" | "downloaded" | "cancelled" | "failed"> {
  const blob = await cardToBlob(canvas);
  if (!blob) return "failed";
  try {
    const file = new File([blob], fileName, { type: "image/png" });
    if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, url: `${SITE_URL}/habit-age` });
      return "shared";
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    // fall through to download
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
