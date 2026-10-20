import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Home-page pop-up (migration 0082). Same pattern as /api/admin/ads: the
// caller's own token proves they are a real admin (RLS against
// admin_profiles), then a service-role client uploads the flyer to the
// existing public "sponsored-ads" bucket (no bucket in this app has storage
// policies, so only a service-role route can ever write to it).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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

// The pop-up button may go to a page on this site ("/free-week") or to
// another site (https://...). Nothing else (no javascript:, no "//host").
function isAllowedLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value) || /^\/[^/\s]\S*$/.test(value) || value === "/";
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const { user, serviceClient } = auth;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Couldn't read the submitted form." }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim();
  const clickUrl = String(form.get("clickUrl") ?? "").trim();
  const buttonLabel = String(form.get("buttonLabel") ?? "").trim() || "Register free";
  const startsAt = String(form.get("startsAt") ?? "").trim();
  const endsAt = String(form.get("endsAt") ?? "").trim();
  const image = form.get("image");

  if (!title) {
    return NextResponse.json({ error: "Please give the pop-up a name (only you see it)." }, { status: 400 });
  }
  if (title.length > 120) {
    return NextResponse.json({ error: "The name is too long (max 120 characters)." }, { status: 400 });
  }
  if (buttonLabel.length > 40) {
    return NextResponse.json({ error: "The button text is too long (max 40 characters)." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    return NextResponse.json({ error: "Please set both a start and an end date." }, { status: 400 });
  }
  if (endsAt < startsAt) {
    return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });
  }
  if (clickUrl && !isAllowedLink(clickUrl)) {
    return NextResponse.json(
      { error: "The link must be a page on this site like /free-week, or start with https://." },
      { status: 400 }
    );
  }
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Please attach the flyer image." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "The image is too large (max 5MB). Please save a smaller copy." }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
    return NextResponse.json({ error: "The image must be a JPG, PNG, or WEBP file." }, { status: 400 });
  }

  const extension = image.type.split("/")[1] ?? "jpg";
  const imagePath = `popup-${crypto.randomUUID()}.${extension}`;
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const { error: uploadError } = await serviceClient.storage
    .from("sponsored-ads")
    .upload(imagePath, imageBytes, { contentType: image.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: `Couldn't upload the image: ${uploadError.message}` }, { status: 502 });
  }
  const imageUrl = serviceClient.storage.from("sponsored-ads").getPublicUrl(imagePath).data.publicUrl;

  const { error: insertError } = await serviceClient.from("site_popups").insert({
    title,
    image_path: imagePath,
    image_url: imageUrl,
    click_url: clickUrl || null,
    button_label: buttonLabel,
    starts_at: startsAt,
    ends_at: endsAt,
    created_by: user.id,
  });
  if (insertError) {
    await serviceClient.storage.from("sponsored-ads").remove([imagePath]);
    const missing = /site_popups|schema cache|does not exist/i.test(insertError.message);
    return NextResponse.json(
      { error: missing ? "The pop-up database step (SQL 0082) hasn't been run yet." : insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
