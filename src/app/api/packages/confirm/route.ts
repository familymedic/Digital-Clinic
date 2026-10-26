import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readSafepayConfig } from "@/lib/safepay";
import { confirmPackagePurchases } from "@/lib/packagePurchase";

// "Confirm on return" for family pack purchases: when the family comes back
// from Safepay we ask Safepay directly (with our secret key) whether the
// payment finished, instead of waiting for the webhook. The browser's word is
// never trusted - only this account's OWN pending purchases are looked at.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "The database isn't connected yet." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Your session isn't valid - please log in again." }, { status: 401 });
  }

  const { config } = readSafepayConfig();
  if (!config) return NextResponse.json({ status: "pending" });

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const status = await confirmPackagePurchases(serviceClient, config, user.id);
  return NextResponse.json({ status });
}
