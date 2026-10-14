import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin "Delete doctor" (2026-10-14, migration 0075). Removes a doctor entry
// that never became a working doctor (registered but didn't continue, never
// approved, never paid). The safety rules live in the database function
// admin_delete_doctor(): it refuses anyone who has consultations, payouts,
// patient feedback or a paid subscription, and it only runs for an admin.
// This route adds the two things the database can't do by itself: remove the
// uploaded certificate files and, when the login has no patient-side history,
// the login account too (so the person can re-apply with the same email).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: doctorId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(doctorId)) {
    return NextResponse.json({ error: "That doctor id isn't valid." }, { status: 400 });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid — please log in again." }, { status: 401 });
  }

  const { data: adminRow, error: adminError } = await userClient
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (adminError) {
    return NextResponse.json({ error: adminError.message }, { status: 500 });
  }
  if (!adminRow) {
    return NextResponse.json({ error: "Only an admin account can do this." }, { status: 403 });
  }

  // The database does the checking and the deleting, all in one transaction.
  const { data, error } = await userClient.rpc("admin_delete_doctor", { p_id: doctorId });
  if (error) {
    const missing =
      error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
    if (missing) {
      return NextResponse.json(
        { error: "Delete isn't switched on yet — the database update (0075) hasn't been run." },
        { status: 503 }
      );
    }
    // Our own friendly refusals (has consultations, is an admin, …) come back as plain messages.
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const result = (data ?? {}) as {
    full_name?: string | null;
    email?: string | null;
    remove_login?: boolean;
    pmdc_certificate_path?: string | null;
    cnic_certificate_path?: string | null;
  };

  const warnings: string[] = [];
  if (SUPABASE_SERVICE_ROLE_KEY) {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const files = [result.pmdc_certificate_path, result.cnic_certificate_path].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (files.length > 0) {
      const { error: rmError } = await serviceClient.storage.from("doctor-documents").remove(files);
      if (rmError) warnings.push("The uploaded certificate files could not be removed.");
    }
    if (result.remove_login) {
      const { error: delError } = await serviceClient.auth.admin.deleteUser(doctorId);
      if (delError) {
        warnings.push(
          "The doctor entry was deleted, but their login account could not be removed, so they may not be able to re-apply with the same email."
        );
      }
    }
  } else if (result.remove_login) {
    warnings.push(
      "The doctor entry was deleted, but their login account was kept because the server key isn't configured."
    );
  }

  return NextResponse.json({
    ok: true,
    name: result.full_name ?? null,
    email: result.email ?? null,
    warnings,
  });
}
