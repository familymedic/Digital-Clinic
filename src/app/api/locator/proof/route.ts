import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { hashToken, locatorClientIp, locatorServiceClient, looksLikeToken, makeLimiter } from "@/lib/locatorServer";
import { PROOF_MAX_BYTES } from "@/lib/locator";

// An owner attaches a proof file (licence, registration certificate, signboard or shop photo)
// to their application. Private storage bucket; only admins can open files (via short-lived
// signed links). The file type is decided by its first bytes, not by what the browser claims.

export const maxDuration = 30;

const limited = makeLimiter(30, 60 * 60 * 1000);

function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  return null;
}

export async function POST(request: NextRequest) {
  const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
  try {
    if (limited(locatorClientIp(request))) return bad("slow_down", 429);
    const form = await request.formData();
    const token = form.get("token");
    const file = form.get("file");
    if (!looksLikeToken(token) || !(file instanceof File)) return bad("bad_request");
    if (file.size === 0 || file.size > PROOF_MAX_BYTES) return bad("file_too_big");
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) return bad("bad_file_type");

    const service = locatorServiceClient();
    if (!service) return bad("unavailable", 503);
    const hash = hashToken(token);
    const { data: info } = await service.rpc("locator_checkout_info", { p_hash: hash });
    const place = info as { id: string } | null;
    if (!place) return bad("not_found", 404);

    const path = `${place.id}/${Date.now()}-${randomBytes(4).toString("hex")}.${kind.ext}`;
    const up = await service.storage.from("locator-proofs").upload(path, buf, { contentType: kind.mime, upsert: false });
    if (up.error) return bad("unavailable", 503);
    const { data: ok } = await service.rpc("locator_attach_proof", { p_place: place.id, p_hash: hash, p_path: path });
    if (ok !== true) {
      await service.storage.from("locator-proofs").remove([path]);
      return bad("too_many_files", 409);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return bad("bad_request");
  }
}
