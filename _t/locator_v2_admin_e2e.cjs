// Admin Locator screen (verification queue, direct add with payment + receipt, fees, reports),
// mocked Supabase + a stored admin session. Run with the dev server on :3100.
const { chromium } = require("playwright");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ADMIN = "00000000-0000-0000-0000-00000000a001";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: ADMIN, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`;
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user: { id: ADMIN, aud: "authenticated", role: "authenticated", email: "admin@x.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
const FUT = new Date(Date.now() + 200 * 864e5).toISOString();
const base = { address: null, phone: "0300-1", notes: null, lat: 24.81, lng: 67.03, doctor_id: null, orientation_date: null, submitted_by_name: null, submitted_by_phone: null, owner_name: null, owner_phone: null, owner_email: null, phone_verified: false, verification_status: "not_required", verification_notes: null, rejection_reason: null, registration_numbers: null, proof_paths: [], manage_token_hash: null, paid_until: null, featured_until: null, created_at: "2026-11-08T10:00:00Z", source: "admin" };
const places = [
  { ...base, id: "p1", category: "doctor", kind: "clinic", name: "Noor Clinic", area: "Clifton", status: "pending", source: "owner", verification_status: "pending", owner_name: "Dr Noor", owner_phone: "0300-1234567", registration_numbers: "PMDC 12345", proof_paths: ["p1/a.jpg", "p1/b.pdf"] },
  { ...base, id: "p2", category: "doctor", kind: "pharmacy", name: "Shifa Pharmacy", area: "Gulshan-e-Iqbal", status: "approved", source: "owner", paid_until: FUT, owner_name: "Ali" },
  { ...base, id: "p3", category: "therapy", kind: "autism_therapy", name: "Hope Therapy Centre", area: "DHA (Defence)", status: "approved", verification_status: "verified" },
  { ...base, id: "p4", category: "autism", kind: "barber", name: "Calm Cuts", area: "Clifton", status: "approved" },
  { ...base, id: "p5", category: "doctor", kind: "lab", name: "Old Lab", area: "Saddar", status: "approved", paid_until: new Date(Date.now() - 5 * 864e5).toISOString() },
];
const summary = { is_live: true, places: { live_doctor: 1, live_therapy: 0, live_autism: 1, pending: 1, awaiting_payment: 1, expiring_30d: 0, expired: 1, hidden: 0 }, open_reports: 1, waitlist: 2, revenue_30d: 4500, revenue_total: 12000, events_7d: { search: 40, results: 35, empty: 5, directions_tap: 12, call_tap: 6 }, events_30d: { search: 150, results: 130, empty: 20, apply: 4, paid: 2 }, by_tab_30d: { doctor: { search: 90, empty: 8, call_tap: 4 }, autism: { search: 40 } }, top_areas_30d: [{ area: "Clifton", searches: 60, empty: 3 }, { area: "North Nazimabad", searches: 25, empty: 14 }], top_places_30d: [{ id: "p2", name: "Shifa Pharmacy", shown: 80, directions: 12, call: 6, book: 0 }], waitlist_cities: [{ city: "Lahore", n: 2 }] };
const fees = [
  { kind: "clinic", label: "Clinic", fee_pkr: 1500, requires_verification: true, accepts_applications: true, sort_order: 10 },
  { kind: "pharmacy", label: "Pharmacy", fee_pkr: 1000, requires_verification: false, accepts_applications: true, sort_order: 50 },
];
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); }, ["sb-localhost-auth-token", JSON.stringify(session)]);
  const page = await ctx.newPage();
  const rpc = [], writes = [];
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/auth/v1/**", (r) => json(r, session.user));
  await page.route("**/rest/v1/admin_profiles*", (r) => json(r, { id: ADMIN, full_name: "Admin", created_at: "2026-01-01T00:00:00Z" }));
  await page.route("**/rest/v1/locator_places*", async (r) => {
    const m = r.request().method();
    if (m === "GET") return json(r, places);
    writes.push({ m, url: r.request().url(), body: r.request().postData() });
    if (m === "POST") return json(r, { id: "new1" }, 201);
    return r.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/locator_waitlist*", (r) => json(r, [{ id: "w1", city: "Lahore", contact: "0300-1234567", interest: "both", created_at: "2026-11-05T00:00:00Z" }]));
  await page.route("**/rest/v1/locator_fees*", async (r) => { if (r.request().method() === "GET") return json(r, fees); writes.push({ m: "PATCH", url: r.request().url(), body: r.request().postData() }); return r.fulfill({ status: 204 }); });
  await page.route("**/rest/v1/locator_reports*", async (r) => { if (r.request().method() === "GET") return json(r, [{ id: "r1", place_id: "p4", reason: "closed", note: "Shut since Eid", status: "open", created_at: "2026-11-07T00:00:00Z", locator_places: { name: "Calm Cuts", area: "Clifton" } }]); return r.fulfill({ status: 204 }); });
  await page.route("**/rest/v1/locator_payments*", (r) => json(r, [{ id: "pay1", place_id: "p2", amount: 1000, method: "cash", status: "succeeded", months: 12, reference: null, receipt_no: 1001, paid_at: "2026-11-02T00:00:00Z", created_at: "2026-11-02T00:00:00Z", locator_places: { name: "Shifa Pharmacy" } }]));
  await page.route("**/rest/v1/locator_settings*", (r) => r.fulfill({ status: 204 }));
  await page.route("**/rest/v1/rpc/*", async (r) => {
    const name = r.request().url().split("/rpc/")[1].split("?")[0];
    const body = JSON.parse(r.request().postData() || "{}");
    rpc.push({ name, body });
    if (name === "locator_admin_summary") return json(r, summary);
    if (name === "locator_admin_record_payment") return json(r, { payment_id: "x", receipt_no: 1004, paid_until: FUT });
    if (name === "locator_admin_make_link") return json(r, "t".repeat(64));
    if (name === "locator_admin_place_stats") return json(r, { shown: 80, directions: 12, call: 6 });
    return r.fulfill({ status: 204 });
  });
  await page.route("**/api/admin/locator/proof", (r) => json(r, { url: "https://example.invalid/file" }));

  await page.goto(BASE + "/admin/locator", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="admin-tab-overview"]');
  const body = async () => page.textContent("body");
  ok((await body()).includes("Revenue, 30 days") && (await body()).includes("PKR 4,500"), "overview shows revenue");
  ok((await body()).includes("North Nazimabad") && (await body()).includes("14 found nothing"), "area breakdown with empty searches");
  ok((await body()).includes("Shifa Pharmacy") && (await body()).includes("dir 12"), "per-place usage");
  ok((await body()).includes("Workplace applications"), "30-day table includes applications");
  await page.screenshot({ path: OUT + "v2-admin-1-overview.png", fullPage: true });

  await page.getByTestId("admin-tab-review").click();
  ok((await page.getByTestId("admin-place").count()) === 1, "one application to review");
  ok((await body()).includes("PMDC 12345") && (await body()).includes("File 2"), "owner details + proof files shown");
  await page.getByRole("button", { name: "File 1" }).evaluate((b) => { window.open = () => null; });
  await page.getByRole("button", { name: "File 1" }).click();
  await page.waitForSelector('button:has-text("Open again")');
  ok(true, "proof file opens through a signed link");
  await page.getByRole("button", { name: "Documents OK: verify" }).click();
  await page.screenshot({ path: OUT + "v2-admin-2-review.png", fullPage: true });
  await page.getByRole("button", { name: "Mark as verified" }).click();
  await page.waitForTimeout(300);
  const v = rpc.find((x) => x.name === "locator_admin_verify");
  ok(v && v.body.p_place === "p1" && v.body.p_decision === "verified", "verify calls the database function");

  await page.getByTestId("admin-tab-unpaid").click();
  ok((await body()).includes("Hope Therapy Centre"), "therapy centre awaiting payment listed");
  await page.getByTestId("admin-record-payment").first().click();
  await page.getByRole("button", { name: "Record payment" }).last().click();
  await page.waitForSelector('[data-testid="admin-receipt"]');
  ok((await page.getByTestId("admin-receipt").textContent()).includes("Receipt no. 1004"), "manual payment gives a receipt number");
  const rp = rpc.find((x) => x.name === "locator_admin_record_payment");
  ok(rp.body.p_amount === 1000 && rp.body.p_method === "cash" && rp.body.p_months === 12, "record payment defaults: cash, 12 months, fallback fee when the type has no fee row");

  await page.getByTestId("admin-tab-expired").click();
  ok((await body()).includes("Old Lab") && (await body()).includes("Expired"), "expired list");
  await page.getByTestId("admin-tab-live").click();
  ok((await body()).includes("Calm Cuts") && (await body()).includes("Shifa Pharmacy") && !(await body()).includes("Old Lab"), "live list = paid + free autism-aware");

  // direct add with payment, no phone code
  await page.getByTestId("admin-add-place").click();
  await page.getByTestId("admin-form-kind").selectOption("pharmacy");
  await page.getByTestId("admin-form-name").fill("Walk-in Pharmacy");
  await page.getByTestId("admin-form-area").fill("Clifton");
  await page.getByTestId("admin-form-link").fill("https://www.google.com/maps/@24.8138,67.0300,17z");
  await page.getByTestId("admin-form-owner-name").fill("Hamza");
  await page.getByTestId("admin-form-owner-phone").fill("0300 5551234");
  ok((await page.getByTestId("admin-form-amount").inputValue()) === "1000", "pharmacy amount defaults to its fee");
  ok((await page.getByTestId("admin-form-verification").inputValue()) === "not_required", "pharmacy defaults to no document check");
  await page.screenshot({ path: OUT + "v2-admin-3-add-form.png", fullPage: true });
  await page.getByTestId("admin-form-submit").click();
  await page.waitForSelector('[data-testid="admin-add-result"]');
  const res = await page.getByTestId("admin-add-result").textContent();
  ok(res.includes("Receipt no. 1004") && res.includes("PKR 1,000"), "direct add shows payment + receipt");
  ok(res.includes("/locator/manage/" + "t".repeat(64)), "direct add shows the owner link");
  const ins = writes.find((w) => w.m === "POST");
  const insBody = JSON.parse(ins.body);
  ok(insBody.source === "admin" && insBody.status === "approved" && insBody.phone_verified === true && insBody.verification_status === "not_required", "inserted as admin entry, number marked confirmed by admin");
  ok(!rpc.some((x) => x.name.includes("code")), "no phone-code step for admin");
  await page.screenshot({ path: OUT + "v2-admin-4-add-result.png", fullPage: true });

  await page.getByTestId("admin-tab-reports").click();
  ok((await body()).includes("Shut since Eid"), "report listed");
  await page.getByTestId("admin-tab-payments").click();
  ok((await body()).includes("#1001"), "payments list");
  await page.getByTestId("admin-tab-fees").click();
  await page.getByLabel("Clinic yearly fee").fill("1750");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.waitForTimeout(300);
  const f = writes.find((w) => w.m === "PATCH" && w.url.includes("locator_fees"));
  ok(f && JSON.parse(f.body).fee_pkr === 1750, "fee edit saved");
  await page.screenshot({ path: OUT + "v2-admin-5-fees.png", fullPage: true });
  await page.getByTestId("admin-tab-poster").click();
  ok(await page.getByTestId("poster-maker").last().isVisible(), "invite poster available");

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
