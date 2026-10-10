import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by the Safepay webhook and the "confirm on return" route, so a
// paid consultation is settled in exactly one way no matter which of the
// two hears about it first. Safe to call twice for the same payment: the
// second call finds the payment already settled and does nothing (so the
// patient also gets only one "payment received" email).

export interface PaymentToSettle {
  id: string;
  consultation_id: string;
  account_id: string;
}

// Returns true if THIS call settled the payment, false if it had already
// been settled (or couldn't be).
export async function settleSucceededPayment(
  serviceClient: SupabaseClient,
  payment: PaymentToSettle,
  rawPayload: unknown
): Promise<boolean> {
  const { data: updated, error } = await serviceClient
    .from("payments")
    .update({ status: "succeeded", raw_webhook_payload: rawPayload, updated_at: new Date().toISOString() })
    .eq("id", payment.id)
    .in("status", ["pending", "failed"])
    .select("id");

  if (error) {
    console.error("settleSucceededPayment: couldn't update payment", { paymentId: payment.id, error });
    return false;
  }
  if (!updated || updated.length === 0) return false; // already settled

  await serviceClient
    .from("consultations")
    .update({ status: "submitted" })
    .eq("id", payment.consultation_id)
    .eq("status", "pending_payment");

  // Fire-and-forget: a slow or failing email must never delay or undo the
  // payment state committed above.
  void sendPaymentOutcomeEmail(serviceClient, payment, "succeeded");
  return true;
}

export async function sendPaymentOutcomeEmail(
  serviceClient: SupabaseClient,
  payment: { consultation_id: string; account_id: string },
  outcome: "succeeded" | "failed"
) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;

    const { data: userRes } = await serviceClient.auth.admin.getUserById(payment.account_id);
    const email = userRes?.user?.email;
    if (!email) return;

    const { data: consultation } = await serviceClient
      .from("consultations")
      .select("complaint")
      .eq("id", payment.consultation_id)
      .maybeSingle();
    const complaint = (consultation as { complaint?: string } | null)?.complaint ?? "your consultation";

    const subject =
      outcome === "succeeded" ? "Payment received — your consultation is confirmed" : "Payment didn't go through";
    const text =
      outcome === "succeeded"
        ? `Your payment for "${complaint}" was received. Your doctor can now see it and will begin reviewing it.`
        : `Your payment for "${complaint}" didn't go through, so this consultation hasn't been booked yet. Please try again from your dashboard, or contact the clinic if this keeps happening.`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Family Medic <onboarding@resend.dev>",
        to: [email],
        subject,
        text,
      }),
    });
  } catch (err) {
    console.error("sendPaymentOutcomeEmail failed (payment state unaffected):", err);
  }
}
