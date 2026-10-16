import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSafepayTracker, toMinorUnits, type SafepayConfig } from "@/lib/safepay";

// Doctor platform access paid through a Safepay checkout (migration 0076).
//
// One successful PKR 2,500 payment = 30 days of access. All the real work
// of turning a payment into days happens inside ONE database function
// (settle_doctor_access_payment), which is atomic and safe to call twice —
// so it does not matter whether the webhook or the "confirm on return"
// route hears about the payment first.

export const DOCTOR_ACCESS_FEE_PKR = 2500;
// A doctor may start a renewal checkout only when access has ended or is
// about to (this many days or fewer left), so nobody pays twice by accident.
export const DOCTOR_ACCESS_RENEW_WINDOW_DAYS = 7;

export interface DoctorAccessProfile {
  is_active: boolean;
  verification_status: string;
  subscription_status: string;
  subscription_current_period_end: string | null;
  use_safepay_checkout: boolean;
}

// Can this doctor start a checkout right now? Returns a plain-language
// reason when not.
export function canStartAccessCheckout(p: DoctorAccessProfile, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (p.verification_status !== "approved" || !p.is_active) {
    return { ok: false, reason: "Your account isn't active yet, so there is nothing to pay for." };
  }
  if (!p.use_safepay_checkout) {
    return { ok: false, reason: "Online payment isn't switched on for your account yet. Please use the payment instructions shown." };
  }
  if (p.subscription_status === "active") {
    if (!p.subscription_current_period_end) {
      return { ok: false, reason: "Your access is active and has no end date, so no payment is needed." };
    }
    const end = new Date(p.subscription_current_period_end).getTime();
    if (end - now > DOCTOR_ACCESS_RENEW_WINDOW_DAYS * 86400000) {
      return {
        ok: false,
        reason: `Your access is paid until ${new Date(end).toLocaleDateString()}. You can renew in the last ${DOCTOR_ACCESS_RENEW_WINDOW_DAYS} days.`,
      };
    }
  }
  return { ok: true };
}

export async function settleDoctorAccessPayment(
  serviceClient: SupabaseClient,
  paymentId: string,
  rawPayload: unknown
): Promise<{ settled: boolean; reason?: string; periodEnd?: string | null; error?: string }> {
  const { data, error } = await serviceClient.rpc("settle_doctor_access_payment", {
    p_payment_id: paymentId,
    p_raw: rawPayload ?? null,
  });
  if (error) {
    console.error("settle_doctor_access_payment failed", { paymentId, error });
    return { settled: false, error: error.message };
  }
  const row = (data ?? {}) as { settled?: boolean; reason?: string; period_end?: string };
  return { settled: !!row.settled, reason: row.reason, periodEnd: row.period_end ?? null };
}

// Asks Safepay directly about this doctor's own unsettled checkouts and
// settles any that have genuinely been paid. Used by the return page.
// Returns "paid" when the doctor now has access from a payment (this call
// or an earlier one), otherwise "pending".
export async function confirmDoctorAccessPayments(
  serviceClient: SupabaseClient,
  config: SafepayConfig,
  doctorId: string
): Promise<"paid" | "pending"> {
  const { data: rows } = await serviceClient
    .from("doctor_access_payments")
    .select("id, amount, status, gateway_tracker_token")
    .eq("doctor_id", doctorId)
    .eq("status", "pending")
    .not("gateway_tracker_token", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const p of rows ?? []) {
    try {
      const info = await fetchSafepayTracker(config, p.gateway_tracker_token as string);
      if (!info.paid) continue;
      if (info.orderId && info.orderId !== p.id) {
        console.error("Doctor access confirm: order reference doesn't match", { paymentId: p.id, orderId: info.orderId });
        continue;
      }
      if (info.amountMinor !== null && info.amountMinor !== toMinorUnits(p.amount as number)) {
        console.error("Doctor access confirm: amount doesn't match", { paymentId: p.id, gotMinor: info.amountMinor });
        continue;
      }
      const r = await settleDoctorAccessPayment(serviceClient, p.id as string, { source: "confirm-on-return", tracker: info.raw });
      if (r.settled || r.reason === "already_settled") return "paid";
    } catch (err) {
      console.error("Doctor access confirm: lookup failed", { paymentId: p.id, err });
    }
  }

  // Already settled earlier (e.g. by the webhook a moment ago)?
  const { data: done } = await serviceClient
    .from("doctor_access_payments")
    .select("id")
    .eq("doctor_id", doctorId)
    .eq("status", "succeeded")
    .gt("period_end", new Date().toISOString())
    .limit(1);
  return done && done.length > 0 ? "paid" : "pending";
}
