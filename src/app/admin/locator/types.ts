import type { LocatorCategory } from "@/lib/locator";

export interface Place {
  id: string;
  category: LocatorCategory;
  kind: string;
  name: string;
  area: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  lat: number;
  lng: number;
  doctor_id: string | null;
  orientation_date: string | null;
  status: "pending" | "approved" | "hidden";
  source: "admin" | "public" | "owner";
  submitted_by_name: string | null;
  submitted_by_phone: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  phone_verified: boolean;
  verification_status: "not_required" | "pending" | "verified" | "rejected";
  verification_notes: string | null;
  rejection_reason: string | null;
  registration_numbers: string | null;
  proof_paths: string[];
  manage_token_hash: string | null;
  paid_until: string | null;
  featured_until: string | null;
  created_at: string;
}

export interface Fee {
  kind: string;
  label: string;
  fee_pkr: number;
  requires_verification: boolean;
  accepts_applications: boolean;
  sort_order: number;
}

export interface Payment {
  id: string;
  place_id: string;
  amount: number;
  method: string;
  status: string;
  months: number;
  reference: string | null;
  receipt_no: number | null;
  paid_at: string | null;
  created_at: string;
}

export interface ReportRow {
  id: string;
  place_id: string;
  reason: string;
  note: string | null;
  status: "open" | "done";
  created_at: string;
  locator_places: { name: string; area: string } | null;
}

export interface Summary {
  is_live: boolean;
  places: {
    live_doctor: number;
    live_therapy: number;
    live_autism: number;
    pending: number;
    awaiting_payment: number;
    expiring_30d: number;
    expired: number;
    hidden: number;
  };
  open_reports: number;
  waitlist: number;
  revenue_30d: number;
  revenue_total: number;
  events_7d: Record<string, number>;
  events_30d: Record<string, number>;
  by_tab_30d: Record<string, Record<string, number>>;
  top_areas_30d: { area: string; searches: number; empty: number }[];
  top_places_30d: { id: string; name: string; shown: number; directions: number; call: number; book: number }[];
  waitlist_cities: { city: string; n: number }[];
}

export const rs = (n: number) => `PKR ${Number(n).toLocaleString("en-PK")}`;

export function waNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.startsWith("92")) return d;
  if (d.startsWith("0")) return "92" + d.slice(1);
  if (d.length === 10) return "92" + d;
  return d;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const REASON_LABEL: Record<string, string> = {
  wrong_info: "Wrong phone, address or timings",
  closed: "Closed or moved",
  not_autism_aware: "Not welcoming to autistic families",
  fake: "Looks fake",
  other: "Something else",
};
