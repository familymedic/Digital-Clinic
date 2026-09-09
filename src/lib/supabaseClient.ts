import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Both values are meant to be public (Supabase's design, not a shortcut we
// took) — real protection comes from the Row Level Security policies in
// the database, not from hiding this key. See supabase/migrations/.
//
// Until a real Supabase project is connected (Phase 3 setup), these env
// vars won't exist. Rather than crash the app, we export `null` and every
// call site checks for that and shows an honest "not connected yet"
// message instead of pretending to work.

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const isDatabaseConfigured = supabase !== null;
