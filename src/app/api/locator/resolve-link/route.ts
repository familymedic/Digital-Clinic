import { NextRequest, NextResponse } from "next/server";
import { coordsFromMapsLink } from "@/lib/locator";
import { locatorClientIp, makeLimiter } from "@/lib/locatorServer";

// Turns a Google Maps "Share" link (maps.app.goo.gl/...) into coordinates. Those short links hide
// the position, so the server opens them and follows the redirects. It ONLY ever contacts Google
// Maps addresses (checked on every hop), follows at most 5 redirects, reads at most 300 KB, and
// gives up after a few seconds, so it cannot be used to reach anything else. The answer is just a
// latitude and longitude; nothing is stored.

export const maxDuration = 20;
export const dynamic = "force-dynamic";

const limited = makeLimiter(30, 60 * 60 * 1000);

const HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "www.google.com.pk",
  "google.com.pk",
]);

function allowed(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  if (u.username || u.password || (u.port && u.port !== "443")) return false;
  if (!HOSTS.has(u.hostname.toLowerCase())) return false;
  if (u.hostname.toLowerCase() === "goo.gl" && !u.pathname.startsWith("/maps")) return false;
  if (/^(www\.)?google\.com(\.pk)?$/i.test(u.hostname) && !u.pathname.startsWith("/maps")) return false;
  return true;
}

function fromText(t: string): { lat: number; lng: number } | null {
  const direct = coordsFromMapsLink(t);
  if (direct) return direct;
  // inside a page: the place pin is written as !3d<lat>!4d<lng>, or the map centre as @lat,lng
  const pin = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
  const at = t.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const c = t.match(/center=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/);
  if (c) return { lat: Number(c[1]), lng: Number(c[2]) };
  // other shapes Google uses: /maps/search/24.86,67.00 , /maps/dir//24.86,67.00 , ?destination=24.86,67.00
  const path = t.match(/\/maps\/(?:search|dir)\/(?:[^/?#]*\/)?\+?(-?\d{1,2}\.\d+),\+?(-?\d{1,3}\.\d+)/);
  if (path) return { lat: Number(path[1]), lng: Number(path[2]) };
  const dest = t.match(/[?&](?:destination|daddr)=(-?\d{1,2}\.\d+)(?:%2C|,)\+?(-?\d{1,3}\.\d+)/);
  if (dest) return { lat: Number(dest[1]), lng: Number(dest[2]) };
  // the place page's own data block starts with [[[zoom, LONGITUDE, LATITUDE]
  const init = t.match(/APP_INITIALIZATION_STATE\s*=\s*\[\[\[\s*-?[\d.]+\s*,\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,2}\.\d+)/);
  if (init) return { lat: Number(init[2]), lng: Number(init[1]) };
  return null;
}

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const text = await request.text();
    if (text.length > 600) return bad("bad_request");
    const b = JSON.parse(text) as { url?: unknown };
    if (typeof b.url !== "string") return bad("bad_request");
    let u: URL;
    try {
      u = new URL(b.url.trim());
    } catch {
      return bad("bad_link");
    }
    if (!allowed(u)) return bad("not_a_maps_link");

    for (let hop = 0; hop < 6; hop++) {
      const here = fromText(u.toString());
      if (here) return NextResponse.json({ ok: true, ...here });
      const res = await fetch(u.toString(), {
        redirect: "manual",
        method: "GET",
        headers: { "user-agent": "Mozilla/5.0 (compatible; FamilyMedicLocator/1.0)", "accept-language": "en" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return bad("cannot_read");
        let next: URL;
        try {
          next = new URL(loc, u);
        } catch {
          return bad("cannot_read");
        }
        if (!allowed(next)) {
          // a redirect off Google Maps (for example a cookie-consent page) may still carry the
          // original Maps address in its query: read it, but never fetch it
          const carried = fromText(decodeURIComponent(next.search));
          return carried ? NextResponse.json({ ok: true, ...carried }) : bad("cannot_read");
        }
        u = next;
        continue;
      }
      if (res.ok) {
        const reader = res.body?.getReader();
        let html = "";
        if (reader) {
          const dec = new TextDecoder();
          let total = 0;
          while (total < 300_000) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            total += value.length;
            html += dec.decode(value, { stream: true });
          }
          reader.cancel().catch(() => {});
        }
        const found = fromText(html);
        return found ? NextResponse.json({ ok: true, ...found }) : bad("cannot_read");
      }
      return bad("cannot_read");
    }
    return bad("cannot_read");
  } catch {
    return bad("cannot_read");
  }
}
