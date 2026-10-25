/* Offline test of the doctor Safepay-access code: fake Supabase (incl. an exact JS copy of the settle rule) + fake Safepay. */
import crypto from "crypto";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supa.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.SAFEPAY_API_KEY = "sec_PUBLIC";
process.env.SAFEPAY_SECRET_KEY = "SECRETKEY";
process.env.SAFEPAY_WEBHOOK_SECRET = "whsec";
process.env.SAFEPAY_ENVIRONMENT = "production";

type Row = Record<string, unknown>;
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const now0 = Date.now();
const prof = (id: string, o: Row = {}): Row => ({
  id, is_active: true, verification_status: "approved", subscription_status: "unpaid", subscription_current_period_end: null,
  use_safepay_checkout: true, subscription_started_at: null, ...o,
});
const db: Record<string, Row[]> = {
  doctor_profiles: [
    prof("d-unpaid"),
    prof("d-manual", { use_safepay_checkout: false }),
    prof("d-soon", { subscription_status: "active", subscription_current_period_end: iso(now0 + 3 * DAY) }),
    prof("d-life", { subscription_status: "active", subscription_current_period_end: null }),
    prof("d-far", { subscription_status: "active", subscription_current_period_end: iso(now0 + 20 * DAY) }),
    prof("d-expired", { subscription_status: "active", subscription_current_period_end: iso(now0 - 1 * DAY) }),
    prof("d-pending", { is_active: false, verification_status: "pending_review" }),
    prof("d-inactive", { is_active: false }),
    prof("d-fail"),
    prof("d-forged"),
    prof("d-other"),
  ],
  doctor_access_payments: [],
  doctor_subscription_events: [],
  payment_webhook_issues: [],
  payments: [],
  consultations: [],
};
const safepayCalls: { url: string; method: string; body: any }[] = [];
let trackerResponse: Record<string, unknown> = {};
let safepayDown = false;
let tick = 0;

function match(row: Row, key: string, expr: string): boolean {
  const [op, ...rest] = expr.split(".");
  const val = rest.join(".");
  const cell = row[key];
  if (op === "eq") return String(cell) === val;
  if (op === "neq") return String(cell) !== val;
  if (op === "gt") return cell != null && new Date(String(cell)).getTime() > new Date(val).getTime();
  if (op === "in") return val.slice(1, -1).split(",").map((x) => x.replace(/"/g, "")).includes(String(cell));
  if (op === "is") return val === "null" ? cell == null : cell != null;
  if (op === "not") {
    const op2 = rest[0], v2 = rest.slice(1).join(".");
    if (op2 === "is" && v2 === "null") return cell != null;
  }
  return true;
}

// Exact JS twin of public.settle_doctor_access_payment (0085: one-time, no end date).
function settleRpc(paymentId: string, raw: unknown) {
  const pay = db.doctor_access_payments.find((p) => p.id === paymentId);
  if (!pay) return { settled: false, reason: "not_found" };
  if (pay.status === "succeeded") return { settled: false, reason: "already_settled", period_end: pay.period_end };
  const d = db.doctor_profiles.find((r) => r.id === pay.doctor_id);
  if (!d) return { settled: false, reason: "doctor_not_found" };
  Object.assign(d, { subscription_status: "active", subscription_current_period_end: null, subscription_started_at: d.subscription_started_at ?? iso(Date.now()) });
  Object.assign(pay, { status: "succeeded", paid_at: iso(Date.now()), period_start: iso(Date.now()), period_end: null, raw_payload: raw });
  db.doctor_subscription_events.push({ doctor_id: pay.doctor_id, event_type: "access_payment.succeeded" });
  return { settled: true, period_end: null };
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const hdrs: Record<string, string> = {};
  new Headers(init?.headers ?? req?.headers).forEach((v, k) => (hdrs[k] = v));
  const bodyText = init?.body ? String(init.body) : req ? await req.text() : "";

  if (url.host === "supa.test") {
    if (url.pathname === "/auth/v1/user") {
      const m = (hdrs.authorization ?? "").match(/^Bearer tok-(.+)$/);
      if (m) return json({ id: m[1], email: m[1] + "@x.com" });
      return json({ message: "bad" }, 401);
    }
    if (url.pathname === "/rest/v1/rpc/settle_doctor_access_payment") {
      const b = JSON.parse(bodyText);
      return json(settleRpc(b.p_payment_id, b.p_raw));
    }
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)/);
    if (m) {
      const table = db[m[1]] ?? (db[m[1]] = []);
      const wantObject = (hdrs.accept ?? "").includes("vnd.pgrst.object");
      const wantRep = (hdrs.prefer ?? "").includes("return=representation");
      const filters = [...url.searchParams.entries()].filter(([k]) => !["select", "order", "limit"].includes(k));
      let rows = table.filter((r) => filters.every(([k, v]) => match(r, k, v)));
      if (method === "POST") {
        const rec = JSON.parse(bodyText) as Row;
        const row = { created_at: iso(Date.now() + ++tick), status: "pending", ...rec };
        table.push(row);
        return respond(wantRep ? row : null, 201);
      }
      if (method === "PATCH") {
        const patch = JSON.parse(bodyText) as Row;
        rows.forEach((r) => Object.assign(r, patch));
        return respond(wantRep ? rows : null, wantRep ? 200 : 204);
      }
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
      }
      const lim = url.searchParams.get("limit");
      if (lim) rows = rows.slice(0, Number(lim));
      if (wantObject) return rows[0] ? json(rows[0]) : new Response(JSON.stringify({ message: "none" }), { status: 406 });
      return json(rows);
    }
    return json({}, 404);
  }

  if (url.host.endsWith("getsafepay.com")) {
    safepayCalls.push({ url: url.toString(), method, body: bodyText ? JSON.parse(bodyText) : null });
    if (safepayDown) return json({ message: "down" }, 500);
    if (url.pathname === "/order/payments/v3/") return json({ data: { tracker: { token: "track_" + ++tick } }, status: { errors: [] } });
    if (url.pathname === "/client/passport/v1/token") return json({ data: "TBT" });
    if (url.pathname.startsWith("/reporter/api/v1/payments/")) return json(trackerResponse);
    return json({}, 404);
  }
  return realFetch(input, init);
}) as typeof fetch;

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
function respond(o: unknown, status: number) {
  if (o === null) return new Response(null, { status: status === 201 ? 201 : 204 });
  return json(o, status);
}

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { failures++; if (extra !== undefined) console.log("      ", JSON.stringify(extra)); }
}
const D = (id: string) => db.doctor_profiles.find((r) => r.id === id)!;
const endMs = (id: string) => new Date(String(D(id).subscription_current_period_end)).getTime();
const near = (a: number, b: number, tol = 120000) => Math.abs(a - b) < tol;

async function main() {
  const checkout = await import("../src/app/api/doctor/access/checkout/route");
  const confirm = await import("../src/app/api/doctor/access/confirm/route");
  const webhook = await import("../src/app/api/payments/webhook/route");
  const lib = await import("../src/lib/doctorAccess");

  const post = (route: any, id: string | null, url = "https://thefamilymedic.com/api/doctor/access/checkout") =>
    route.POST(new NextRequest(url, { method: "POST", headers: id ? { authorization: `Bearer tok-${id}` } : {} }));
  const startFor = async (id: string) => { const r = await post(checkout, id); return { status: r.status, json: await r.json() }; };

  // ---- pure rule
  const base = { is_active: true, verification_status: "approved", subscription_status: "unpaid", subscription_current_period_end: null, use_safepay_checkout: true };
  check("rule: unpaid approved -> ok", lib.canStartAccessCheckout(base).ok);
  check("rule: flag off -> no", !lib.canStartAccessCheckout({ ...base, use_safepay_checkout: false }).ok);
  check("rule: active, 20d left -> no", !lib.canStartAccessCheckout({ ...base, subscription_status: "active", subscription_current_period_end: iso(now0 + 20 * DAY) }).ok);
  check("rule: active, 3d left (old month) -> no (nothing to renew any more)", !lib.canStartAccessCheckout({ ...base, subscription_status: "active", subscription_current_period_end: iso(now0 + 3 * DAY) }).ok);
  check("rule: active, old month already ended -> ok (pay once)", lib.canStartAccessCheckout({ ...base, subscription_status: "active", subscription_current_period_end: iso(now0 - DAY) }).ok);
  check("rule: active, no end date -> no", !lib.canStartAccessCheckout({ ...base, subscription_status: "active" }).ok);
  check("rule: past_due/canceled -> ok", lib.canStartAccessCheckout({ ...base, subscription_status: "past_due" }).ok && lib.canStartAccessCheckout({ ...base, subscription_status: "canceled" }).ok);
  check("rule: not approved / inactive -> no", !lib.canStartAccessCheckout({ ...base, verification_status: "pending_review" }).ok && !lib.canStartAccessCheckout({ ...base, is_active: false }).ok);

  // ---- checkout route
  check("checkout: no token -> 401", (await post(checkout, null)).status === 401);
  check("checkout: signed in but not a doctor -> 403", (await post(checkout, "nobody")).status === 403);
  let r = await startFor("d-unpaid");
  check("checkout: unpaid doctor -> 200 + url", r.status === 200 && !!r.json.checkoutUrl, r);
  const sess = safepayCalls.filter((c) => c.url.includes("/order/payments/v3/")).pop()!;
  const row = db.doctor_access_payments[0];
  check("checkout: amount 2500 PKR -> 250000 minor", sess.body.amount === 250000 && sess.body.currency === "PKR", sess.body);
  check("checkout: metadata.order_id == our row id", sess.body.metadata.order_id === row.id, { m: sess.body.metadata, id: row.id });
  check("checkout: row = pending, 2500, production, right doctor, tracker stored", row.status === "pending" && row.amount === 2500 && row.gateway_environment === "production" && row.doctor_id === "d-unpaid" && String(row.gateway_tracker_token).startsWith("track_"), row);
  const cu = new URL(r.json.checkoutUrl);
  check("checkout: host production", cu.origin + cu.pathname === "https://getsafepay.com/embedded/", r.json.checkoutUrl);
  check("checkout: redirect_url clean (no query of ours)", cu.searchParams.get("redirect_url") === "https://thefamilymedic.com/doctor/access-return", cu.searchParams.get("redirect_url"));
  check("checkout: cancel_url", cu.searchParams.get("cancel_url") === "https://thefamilymedic.com/doctor/access-return?outcome=cancelled");
  check("checkout: manual doctor (flag off) -> 409", (await startFor("d-manual")).status === 409);
  check("checkout: active with 20d left -> 409", (await startFor("d-far")).status === 409);
  check("checkout: active with 3d left -> 409 (no renewals)", (await startFor("d-soon")).status === 409);
  check("checkout: active for life (no end date) -> 409", (await startFor("d-life")).status === 409);
  check("checkout: expired -> 200", (await startFor("d-expired")).status === 200);
  check("checkout: pending approval -> 409", (await startFor("d-pending")).status === 409);
  check("checkout: deactivated -> 409", (await startFor("d-inactive")).status === 409);
  const rowsBefore = db.doctor_access_payments.length;
  safepayDown = true;
  r = await startFor("d-fail");
  check("checkout: Safepay down -> 502 and NO row saved", r.status === 502 && db.doctor_access_payments.length === rowsBefore, r);
  safepayDown = false;

  // ---- confirm route
  const myPay = (doc: string) => db.doctor_access_payments.filter((p) => p.doctor_id === doc).pop()!;
  const cf = async (id: string | null) => { const x = await post(confirm, id, "https://thefamilymedic.com/api/doctor/access/confirm"); return { status: x.status, json: await x.json() }; };
  const trk = (p: Row, state: string, amountMinor: number, orderId?: string) => (trackerResponse = { ok: true, data: { state, metadata: { order_id: { value: orderId ?? p.id } }, purchase_totals: { quote_amount: { amount: amountMinor } } } });
  const pU = myPay("d-unpaid");
  check("confirm: no token -> 401", (await cf(null)).status === 401);
  trk(pU, "TRACKER_STARTED", 250000);
  let c = await cf("d-unpaid");
  check("confirm: not paid yet -> pending, doctor still unpaid", c.json.status === "pending" && D("d-unpaid").subscription_status === "unpaid", c);
  trk(pU, "TRACKER_ENDED", 100);
  c = await cf("d-unpaid");
  check("confirm: wrong amount -> NOT settled", c.json.status === "pending" && D("d-unpaid").subscription_status === "unpaid", c);
  trk(pU, "TRACKER_ENDED", 250000, "someone-elses-order");
  c = await cf("d-unpaid");
  check("confirm: order id mismatch -> NOT settled", c.json.status === "pending" && D("d-unpaid").subscription_status === "unpaid", c);
  trk(pU, "TRACKER_ENDED", 250000);
  c = await cf("d-other");
  check("confirm: another doctor cannot settle this doctor's payment", D("d-unpaid").subscription_status === "unpaid", c);
  c = await cf("d-unpaid");
  check("confirm: paid -> 'paid', doctor active with NO end date", c.json.status === "paid" && D("d-unpaid").subscription_status === "active" && D("d-unpaid").subscription_current_period_end === null, { c, end: D("d-unpaid").subscription_current_period_end });
  c = await cf("d-unpaid");
  check("confirm again -> still paid, settled only once", c.json.status === "paid" && D("d-unpaid").subscription_current_period_end === null && db.doctor_subscription_events.filter((e) => e.doctor_id === "d-unpaid").length === 1, c);
  check("confirm: a doctor with no payment of their own is not 'paid'", (await cf("d-other")).json.status === "pending");

  // ---- webhook
  const event = (type: string, tracker: string, orderId: string, amount = 250000) =>
    JSON.stringify({ token: "evt", version: "2.0.0", type, data: { tracker, state: "TRACKER_ENDED", amount, currency: "PKR", metadata: { order_id: orderId } } });
  const sign = (t: string, secret = "whsec") => crypto.createHmac("sha512", secret).update(t).digest("hex");
  const hook = (raw: string, sig: string | null) => webhook.POST(new NextRequest("https://x/api/payments/webhook", { method: "POST", body: raw, headers: sig ? { "x-sfpy-signature": sig } : {} }));

  // expired old month -> pays once -> no end date
  const pE = myPay("d-expired");
  let raw = event("payment.succeeded", String(pE.gateway_tracker_token), String(pE.id));
  let res = await hook(raw, sign(raw));
  check("webhook: lapsed doctor pays once -> access with NO end date", pE.status === "succeeded" && D("d-expired").subscription_status === "active" && D("d-expired").subscription_current_period_end === null, { note: await res.json() });
  res = await hook(raw, sign(raw));
  check("webhook: replay -> 'already processed', still one event", (await res.json()).note === "already processed" && db.doctor_subscription_events.filter((e) => e.doctor_id === "d-expired").length === 1);

  // forged
  const rowF = (await startFor("d-forged")).status === 200 ? myPay("d-forged") : null;
  trackerResponse = { ok: true, data: { state: "TRACKER_STARTED", metadata: {} } };
  raw = event("payment.succeeded", String(rowF!.gateway_tracker_token), String(rowF!.id));
  await hook(raw, "deadbeef");
  check("webhook: forged signature + not paid at Safepay -> NOT settled, issue logged", rowF!.status === "pending" && D("d-forged").subscription_status === "unpaid" && db.payment_webhook_issues.length >= 1);
  // wrong amount, valid signature
  raw = event("payment.succeeded", String(rowF!.gateway_tracker_token), String(rowF!.id), 100);
  await hook(raw, sign(raw));
  check("webhook: wrong amount -> NOT settled", rowF!.status === "pending" && D("d-forged").subscription_status === "unpaid");
  // failed event keeps it open
  raw = event("payment.failed", String(rowF!.gateway_tracker_token), String(rowF!.id));
  await hook(raw, sign(raw));
  check("webhook: payment.failed leaves it open", rowF!.status === "pending" && D("d-forged").subscription_status === "unpaid");
  // no signature but Safepay confirms
  trackerResponse = { ok: true, data: { state: "TRACKER_ENDED", metadata: { order_id: rowF!.id }, purchase_totals: { quote_amount: { amount: 250000 } } } };
  raw = event("payment.succeeded", String(rowF!.gateway_tracker_token), String(rowF!.id));
  await hook(raw, null);
  check("webhook: no signature but Safepay confirms -> settled", rowF!.status === "succeeded" && D("d-forged").subscription_status === "active");

  // ---- regression: a normal consultation payment still settles through the same webhook
  db.consultations.push({ id: "c1", status: "pending_payment", patient_id: "u1", doctor_id: "d-far", complaint: "cough" });
  db.payments.push({ id: "pay-1", consultation_id: "c1", account_id: "u1", amount: 500, status: "pending", gateway_tracker_token: "track_consult", created_at: iso(Date.now()) });
  raw = JSON.stringify({ type: "payment.succeeded", data: { tracker: "track_consult", amount: 50000, metadata: { order_id: "pay-1" } } });
  await hook(raw, sign(raw));
  check("regression: consultation payment webhook still settles", db.payments[0].status === "succeeded" && db.consultations[0].status === "submitted");
  // unknown tracker, not ours
  raw = JSON.stringify({ type: "payment.succeeded", data: { tracker: "track_unknown", amount: 1, metadata: { order_id: "nope" } } });
  res = await hook(raw, sign(raw));
  check("regression: unknown payment -> acknowledged, nothing changed", res.status === 200 && (await res.json()).note === "no matching payment");

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
