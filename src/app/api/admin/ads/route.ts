import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sponsored ads (2026-09-15): a paid, clearly-labeled sponsor placement
// on the public home page — the physician asked whether pharma
// companies renting an ad slot could help with revenue. Scoped and
// confirmed before building: images only for now (video is a real
// follow-up, not built here); a single rotating slot on the page if more
// than one sponsor overlaps; no price/payment tracking in the app at all
// (that stays entirely outside the platform).
//
// Same authorization pattern as every other privileged route in this
// app: the caller's own token re-verifies they're a real admin (via RLS
// against admin_profiles) before the service-role client — needed here
// because uploading to the "sponsored-ads" storage bucket, like every
// bucket in this app, has zero storage policies and can only ever be
// touched by a service-role route, never a direct client write.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — a marketing banner, not a document scan
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function requireAdmin(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { error: NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 }) };
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return { error: NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 }) };
  }

  const { data: adminRow, error: adminError } = await userClient
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (adminError) {
    return { error: NextResponse.json({ error: adminError.message }, { status: 500 }) };
  }
  if (!adminRow) {
    return { error: NextResponse.json({ error: "Only an admin account can do this." }, { status: 403 }) };
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error: NextResponse.json(
        { error: "This needs the Supabase service-role key configured on the server first." },
        { status: 503 }
      ),
    };
  }

  return { user, serviceClient: createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { user, serviceClient } = auth;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const sponsorName = String(form.get("sponsorName") ?? "").trim();
  const clickUrl = String(form.get("clickUrl") ?? "").trim();
  const startsAt = String(form.get("startsAt") ?? "").trim();
  const endsAt = String(form.get("endsAt") ?? "").trim();
  const image = form.get("image");

  if (!sponsorName) {
    return NextResponse.json({ error: "Please enter the sponsor's name." }, { status: 400 });
  }
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Please set both a start and an end date." }, { status: 400 });
  }
  if (endsAt < startsAt) {
    return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });
  }
  if (clickUrl && !/^https?:\/\//i.test(clickUrl)) {
    return NextResponse.json({ error: "The click-through link must start with http:// or https://." }, { status: 400 });
  }
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Please attach the ad image." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "The image is too large (max 5MB)." }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
    return NextResponse.json({ error: "The image must be a JPG, PNG, or WEBP file." }, { status: 400 });
  }

  const extension = image.type.split("/")[1] ?? "jpg";
  const imagePath = `${crypto.randomUUID()}.${extension}`;
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const { error: uploadError } = await serviceClient.storage
    .from("sponsored-ads")
    .upload(imagePath, imageBytes, { contentType: image.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: `Couldn't upload the image: ${uploadError.message}` }, { status: 502 });
  }
  const imageUrl = serviceClient.storage.from("sponsored-ads").getPublicUrl(imagePath).data.publicUrl;

  const { error: insertError } = await serviceClient.from("sponsored_ads").insert({
    sponsor_name: sponsorName,
    image_path: imagePath,
    image_url: imageUrl,
    click_url: clickUrl || null,
    starts_at: startsAt,
    ends_at: endsAt,
    created_by: user.id,
  });

  if (insertError) {
    // Don't leave an orphaned file behind if the row itself couldn't be saved.
    await serviceClient.storage.from("sponsored-ads").remove([imagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
