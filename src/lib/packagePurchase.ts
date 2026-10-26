import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSafepayTracker, toMinorUnits, type SafepayConfig } from "@/lib/safepay";

// Family pack purchases paid through a Safepay checkout (migrations 0088-0090).
//
// Same safety pattern as the doctor-access payment (0076): our own purchase id
// goes to Safepay as the order reference, the price is fixed by the database
// (never read from the browser), only the server (service role) can create or
// settle a purchase, and settling is one atomic database function that is safe
// to call twice - so it does not matter whether the webhook or the
// "confirm on return" route hears about the payment first.

export async function settlePackagePurchase(
  serviceClient: SupabaseClient,
  purchaseId: string,
  rawPayload: unknown
): Promise<{ settled: boolean; reason?: string; error?: string }> {
  const { data, error } = await serviceClient.rpc("settle_package_purchase", {
    p_purchase_id: purchaseId,
    p_raw: rawPayload ?? null,
  });
  if (error) {
    console.error("settle_package_purchase failed", { purchaseId, error });
    return { settled: false, error: error.message };
  }
  const row = (data ?? {}) as { settled?: boolean; reason?: string };
  return { settled: !!row.settled, reason: row.reason };
}

// Asks Safepay directly about this family's own unsettled pack checkouts and
// settles any that have genuinely been paid. Returns "paid" when the family
// now has a live pack from a payment (this call or an earlier one).
export async function confirmPackagePurchases(
  serviceClient: SupabaseClient,
  config: SafepayConfig,
  accountId: string
): Promise<"paid" | "pending"> {
  const { data: rows } = await serviceClient
    .from("family_package_purchases")
    .select("id, price_pkr, status, gateway_tracker_token")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .not("gateway_tracker_token", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const p of rows ?? []) {
    try {
      const info = await fetchSafepayTracker(config, p.gateway_tracker_token as string);
      if (!info.paid) continue;
      if (info.orderId && info.orderId !== p.id) {
        console.error("Pack confirm: order reference doesn't match", { purchaseId: p.id, orderId: info.orderId });
        continue;
      }
      if (info.amountMinor !== null && info.amountMinor !== toMinorUnits(p.price_pkr as number)) {
        console.error("Pack confirm: amount doesn't match", { purchaseId: p.id, gotMinor: info.amountMinor });
        continue;
      }
      const r = await settlePackagePurchase(serviceClient, p.id as string, { source: "confirm-on-return", tracker: info.raw });
      if (r.settled || r.reason === "already_settled") return "paid";
    } catch (err) {
      console.error("Pack confirm: lookup failed", { purchaseId: p.id, err });
    }
  }

  // Already settled a moment ago (e.g. by the webhook)?
  const { data: live } = await serviceClient
    .from("family_package_purchases")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "active")
    .eq("payment_method", "safepay")
    .gt("paid_at", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
    .limit(1);
  return live && live.length > 0 ? "paid" : "pending";
}
