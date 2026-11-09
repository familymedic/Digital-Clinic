// Click-through test for Locator v2 (tiles, pin map, List your workplace, owner page, payment return)
// with a mocked Supabase. Run with the dev server on :3100.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
const TOKEN = "a".repeat(64);
const doc = (id, n, name, d, la, ln, extra = {}) => ({ id, category: "doctor", kind: "clinic", name, area: "Clifton", address: null, phone: "0300-2222222", notes: null, doctor_id: null, orientation_date: null, distance_km: d, map_lat: la, map_lng: ln, verified: true, verified_on: "2026-11-01", featured: false, ...extra });
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pktDay = (add = 0) => KEYS[(new Date(Date.now() + 5 * 3600e3 + add * 864e5).getUTCDay())];
const rows = (cat, kind) => {
  if (cat === "pharmacy") return [
    { ...doc("ph1", 1, "Shifa Pharmacy 24h", 0.5, 24.8160, 67.0330), category: "pharmacy", kind: "pharmacy", verified: false, hours: { always: true } },
    { ...doc("ph2", 2, "Evening Pharmacy", 1.4, 24.8200, 67.0400), category: "pharmacy", kind: "pharmacy", verified: false, hours: { days: { [pktDay(1)]: [["09:00", "17:00"]] } } },
    { ...doc("ph3", 3, "No Hours Pharmacy", 2.2, 24.8000, 67.0150), category: "pharmacy", kind: "pharmacy", verified: false, hours: null },
  ];
  if (cat === "autism") return [
    { ...doc("a1", 1, "Calm Cuts", 0.4, 24.816, 67.032), category: "autism", kind: "barber", verified: false, orientation_date: "2026-10-01" },
    { ...doc("a2", 2, "Soft Table", 1.8, 24.826, 67.041), category: "autism", kind: "restaurant", verified: false, orientation_date: "2026-10-12" },
  ].filter((r) => !kind || r.kind === kind);
  if (cat === "therapy") return [{ ...doc("t1", 1, "Hope Therapy Centre", 1.2, 24.822, 67.021), category: "therapy", kind: "autism_therapy" }];
  return [
    doc("d1", 1, "Dr. Example Family Clinic", 0.2, 24.8150, 67.0310, { featured: true, doctor_id: "11111111-1111-1111-1111-111111111111" }),
    doc("d2", 2, "Sample Care Clinic", 1.9, 24.8300, 67.0420),
    doc("d3", 3, "Sample Lab", 2.4, 24.8000, 67.0150, { kind: "lab", verified: false }),
  ];
};
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["geolocation"], geolocation: { latitude: 24.8138, longitude: 67.03 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const calls = [], events = [], reports = [];
  await page.addInitScript(() => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); });
  await page.route("**/rest/v1/rpc/locator_counts", (r) => r.fulfill({ json: { live: true, doctor: 3, pharmacy: 3, therapy: 1, autism: 2 } }));
  await page.route("**/rest/v1/rpc/locator_fee_list", (r) => r.fulfill({ json: [
    { kind: "clinic", label: "Clinic", fee_pkr: 1800, requires_verification: true },
    { kind: "pharmacy", label: "Pharmacy", fee_pkr: 900, requires_verification: false },
    { kind: "autism_therapy", label: "Autism therapy centre", fee_pkr: 1600, requires_verification: true },
  ] }));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => {
    const b = JSON.parse(r.request().postData() || "{}"); calls.push(b);
    await r.fulfill({ json: rows(b.p_category, b.p_kind) });
  });
  await page.route("**/api/locator/event", async (r) => { events.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ status: 204 }); });
  await page.route("**/api/locator/report", async (r) => { reports.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ json: { ok: true } }); });

  // ---------------------------------------------------------------- home
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  ok(await page.getByTestId("locator-tile-doctor").isVisible(), "doctor tile");
  ok(await page.getByTestId("locator-tile-pharmacy").isVisible(), "pharmacy tile");
  ok(await page.getByTestId("locator-tile-therapy").isVisible(), "therapy tile");
  ok(await page.getByTestId("locator-tile-autism").isVisible(), "autism tile");
  const order = await page.$$eval('[data-testid^="locator-tile-"]', (els) => els.map((e) => e.getAttribute("data-testid")));
  ok(order.join() === "locator-tile-doctor,locator-tile-pharmacy,locator-tile-therapy,locator-tile-autism", "tiles in the requested order (doctors, pharmacies, therapy, autism)");
  ok((await page.textContent("body")).includes("3 places listed"), "counts on tile");
  ok(await page.getByTestId("locator-list-cta").isVisible(), "List your workplace banner");
  await page.screenshot({ path: OUT + "v2-1-home.png" });

  await page.getByTestId("locator-use-location").first().click();
  await page.waitForTimeout(500);
  ok(calls.length === 0, "choosing location on home does not search yet");

  // ---------------------------------------------------------------- doctors results + map
  await page.getByTestId("locator-tile-doctor").click();
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(calls[0].p_category === "doctor" && Math.abs(calls[0].p_lat - 24.8138) < 1e-6, "doctor search from GPS");
  ok((await page.getByTestId("locator-result").count()) === 3, "3 doctor results");
  ok((await page.getByTestId("locator-pin").count()) === 3, "3 numbered pins on the map");
  const pinNums = await page.$$eval('[data-testid="locator-pin"] text', (els) => els.map((e) => e.textContent));
  ok(pinNums.join() === "1,2,3", "pins numbered 1,2,3");
  const href = await page.locator('[data-testid="locator-directions"]').first().getAttribute("href");
  ok(href === "/api/locator/go/d1", "Directions goes through the counted link");
  ok((await page.textContent("body")).includes("Featured"), "featured badge");
  ok((await page.textContent("body")).includes("Documents checked by Family Medic"), "verified label");
  ok((await page.textContent("body")).includes("Book online"), "book online for linked doctor");
  await page.screenshot({ path: OUT + "v2-2-doctors.png", fullPage: true });
  const shown = events.find((e) => e.event === "results");
  ok(shown && shown.ids.length === 3 && shown.area === "My location", "results event carries ids + area label (no coordinates)");
  ok(!JSON.stringify(events).includes("24.81"), "no coordinates sent to counters");

  // pin tap highlights list item
  await page.locator('[data-testid="locator-pin"]').nth(1).click();
  ok(await page.locator('[data-place="d2"]').evaluate((e) => e.className.includes("ring-2")), "tapping a pin highlights its card");

  // call tap counts per place
  await page.locator('[data-place="d2"] a:has-text("Call")').evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await page.locator('[data-place="d2"] a:has-text("Call")').click();
  await page.waitForTimeout(200);
  ok(events.some((e) => e.event === "call_tap" && e.placeId === "d2"), "call tap counted for that place");

  // report a problem
  await page.locator('[data-place="d2"] button:has-text("Report a problem")').click();
  await page.locator('[data-place="d2"] select').selectOption("closed");
  await page.locator('[data-place="d2"] button:has-text("Send report")').click();
  await page.waitForSelector("text=Our team will check this listing");
  ok(reports[0].placeId === "d2" && reports[0].reason === "closed" && reports[0].website === "", "report posted");

  // radius
  await page.getByTestId("locator-radius-2").click();
  await page.waitForTimeout(300);
  ok(calls[calls.length - 1].p_radius_km === 2, "radius chip re-searches");

  // ---------------------------------------------------------------- back, therapy, autism
  await page.getByTestId("locator-back").click();
  await page.getByTestId("locator-tile-therapy").click();
  await page.waitForSelector(`[data-testid="locator-result"]`); await page.waitForTimeout(200);
  ok(calls[calls.length - 1].p_category === "therapy", "therapy tile searches therapy");
  await page.getByRole("button", { name: "Speech therapy" }).click();
  await page.waitForTimeout(300);
  ok(calls[calls.length - 1].p_kind === "speech", "therapy kind chip filters");
  await page.getByTestId("locator-back").click();

  await page.getByTestId("locator-tile-autism").click();
  await page.waitForSelector('[data-testid="locator-category"]');
  await page.waitForTimeout(400);
  ok((await page.textContent("body")).includes("Barber shop"), "autism category grid");
  ok((await page.getByTestId("locator-kind-barber").textContent()).includes("1 nearby"), "barber count from results");
  ok((await page.getByTestId("locator-kind-park").textContent()).includes("None yet"), "empty kinds say none yet");
  await page.screenshot({ path: OUT + "v2-3-autism-category.png", fullPage: true });
  await page.getByTestId("locator-kind-barber").click();
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(calls[calls.length - 1].p_kind === "barber", "barber filter sent");
  ok((await page.textContent("body")).includes("Autism-Aware Place · Oct 2026"), "autism label with month");
  await page.screenshot({ path: OUT + "v2-4-autism-results.png", fullPage: true });
  await page.getByTestId("locator-back").click();
  ok(await page.getByTestId("locator-category").isVisible(), "back from kind returns to category grid");

  // ---------------------------------------------------------------- pharmacies: own tab, opening hours
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForTimeout(400);
  await page.getByTestId("locator-tile-pharmacy").click();
  await page.waitForSelector('[data-testid="locator-result"]'); await page.waitForTimeout(200);
  ok(calls[calls.length - 1].p_category === "pharmacy", "pharmacy tile searches the pharmacy category");
  ok((await page.getByTestId("locator-result").count()) === 3, "three pharmacies listed");
  ok(!(await page.textContent("body")).includes("Sample Care Clinic"), "no clinics in the pharmacy tab");
  ok((await page.getByRole("button", { name: "Clinic", exact: true }).count()) === 0, "no clinic/hospital type chips on the pharmacy tab");
  const bodyText = await page.textContent("body");
  ok(bodyText.includes("Open 24 hours"), "24-hour pharmacy says Open 24 hours");
  ok(bodyText.includes("Closed now · opens tomorrow 9 am"), "closed pharmacy says when it opens (tomorrow 9 am)");
  ok((await page.getByTestId("locator-hours").count()) === 2, "pharmacy with no hours shows no hours line");
  await page.getByRole("button", { name: "All hours" }).click();
  ok((await page.textContent("body")).includes("Sunday") && (await page.textContent("body")).includes("9 am to 5 pm"), "full week of hours can be opened");
  await page.screenshot({ path: OUT + "v3-1-pharmacy-hours.png", fullPage: true });
  await page.getByRole("button", { name: "Open now", exact: true }).click();
  ok((await page.getByTestId("locator-result").count()) === 1 && (await page.textContent("body")).includes("Shifa Pharmacy 24h"), "'Open now' keeps only pharmacies that are open");
  await page.getByRole("button", { name: "Open now", exact: true }).click();
  ok((await page.getByTestId("locator-result").count()) === 3, "switching 'Open now' off shows all again");
  const doctorCountsBefore = calls.length;
  await page.getByTestId("locator-back").click();
  await page.getByTestId("locator-tile-doctor").click();
  await page.waitForSelector('[data-testid="locator-result"]'); await page.waitForTimeout(200);
  ok(calls.length > doctorCountsBefore && calls[calls.length - 1].p_category === "doctor", "doctors tab still searches doctors");
  ok((await page.textContent("body")).includes("Sample Lab"), "labs stay under Doctors & Clinics");

  // ---------------------------------------------------------------- list wizard
  const applied = [];
  await page.route("**/api/locator/apply", async (r) => { applied.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ json: { ok: true, token: TOKEN, requiresVerification: false, feePkr: 900, phoneVerified: false } }); });
  const proofs = [];
  await page.route("**/api/locator/proof", async (r) => { proofs.push(r.request().postDataBuffer().length); await r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/locator/pay", async (r) => r.fulfill({ json: { ok: true, checkoutUrl: BASE + "/locator/paid?outcome=cancelled" } }));
  await page.goto(BASE + "/locator/list", { waitUntil: "networkidle" });
  ok((await page.getByTestId("list-kind-pharmacy").textContent()).includes("PKR 900 a year"), "wizard shows DB fee");
  ok((await page.getByTestId("list-kind-clinic").textContent()).includes("documents checked first"), "clinic says documents checked first");
  ok((await page.getByTestId("list-kind-pharmacy").textContent()).includes("no document check"), "pharmacy says no document check");
  await page.getByTestId("list-next").click();
  ok((await page.textContent("body")).includes("Please choose what you are listing"), "cannot skip step 1");
  await page.getByTestId("list-kind-pharmacy").click();
  await page.screenshot({ path: OUT + "v2-5-list-step1.png", fullPage: true });
  await page.getByTestId("list-next").click();
  await page.getByTestId("list-name").fill("Shifa Pharmacy");
  await page.getByTestId("list-area").selectOption("Clifton");
  await page.getByTestId("list-hours-mode-times").click();
  await page.getByTestId("list-hours-copy-mon-sat").click();
  await page.getByTestId("list-hours-mode-always").click();
  ok(await page.getByTestId("list-hours-day-mon").count() === 0, "24-hours choice hides the day rows");
  await page.getByTestId("list-next").click();
  await page.getByTestId("list-next").click();
  ok((await page.textContent("body")).includes("drop the pin"), "cannot skip the pin step");
  let resolveMode = "fail"; const resolved = [];
  await page.route("**/api/locator/resolve-link", async (r) => { resolved.push(JSON.parse(r.request().postData() || "{}").url); await r.fulfill({ json: resolveMode === "fail" ? { ok: false, error: "cannot_read" } : { ok: true, lat: 24.8138, lng: 67.03 } }); });
  await page.getByTestId("list-paste").fill("https://maps.app.goo.gl/AbCdEf123");
  await page.waitForTimeout(400);
  ok(resolved.length === 1 && !(await page.getByTestId("list-pin-ok").count()), "short link that cannot be read asks the server, then explains");
  ok((await page.textContent("body")).includes("could not read a location from that link"), "helpful message for an unreadable link");
  resolveMode = "ok";
  await page.getByTestId("list-paste").fill("https://maps.app.goo.gl/XyZ987");
  await page.waitForSelector('[data-testid="list-pin-ok"]');
  ok(resolved.length === 2 && resolved[1] === "https://maps.app.goo.gl/XyZ987", "short Google Maps link is resolved by our server");
  await page.getByTestId("list-paste").fill("https://www.google.com/maps/@24.8138,67.0300,17z");
  await page.waitForTimeout(300);
  ok(resolved.length === 2, "long link is read in the browser (no server call)");
  ok(await page.getByTestId("list-pin-ok").isVisible(), "pin read from Google Maps link");
  await page.getByTestId("list-use-here").click();
  await page.waitForTimeout(500);
  ok((await page.textContent("body")).includes("Pin saved from your GPS"), "GPS button sets the pin");
  await page.getByTestId("list-paste").fill("24.8138, 67.0300");
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + "v2-6-list-pin.png", fullPage: true });
  await page.getByTestId("list-next").click();
  await page.getByTestId("list-owner-name").fill("Ali Raza");
  await page.getByTestId("list-owner-phone").fill("0300 1234567");
  ok(!(await page.textContent("body")).includes("Send code"), "no dead 'Send code' button when SMS is not configured");
  await page.getByTestId("list-submit").click();
  await page.waitForTimeout(200);
  ok(applied.length === 0, "needs the consent tick first (browser validation)");
  await page.getByTestId("list-consent").check();
  await page.getByTestId("list-submit").click();
  ok((await page.textContent("body")).includes("Please attach a photo of your shop signboard"), "needs a signboard photo");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync("/tmp/sign.png", png);
  await page.getByTestId("list-files").setInputFiles("/tmp/sign.png");
  await page.screenshot({ path: OUT + "v2-7-list-you.png", fullPage: true });
  await page.getByTestId("list-submit").click();
  await page.waitForSelector("text=We have received your application");
  ok(applied[0].kind === "pharmacy" && applied[0].name === "Shifa Pharmacy" && applied[0].consent === true && Math.abs(applied[0].lat - 24.8138) < 1e-6, "apply payload ok");
  ok(applied[0].website === "", "apply honeypot empty");
  ok(applied[0].hours && applied[0].hours.always === true, "opening hours sent with the application");
  ok(proofs.length === 1, "proof file uploaded");
  ok((await page.getByTestId("list-manage-link").textContent()).endsWith("/locator/manage/" + TOKEN), "private link shown");
  ok(await page.getByTestId("list-pay").isVisible(), "pharmacy can pay immediately");
  await page.screenshot({ path: OUT + "v2-8-list-done.png", fullPage: true });

  // ---------------------------------------------------------------- owner page
  const place = (o) => ({ id: "p1", name: "Noor Clinic", kind: "clinic", category: "doctor", area: "Clifton", status: "approved", verification_status: "verified", rejection_reason: null, paid_until: null, fee_pkr: 1800, requires_verification: true, live: false, phone_verified: false, ...o });
  let current = place({});
  await page.route("**/api/locator/manage", (r) => r.fulfill({ json: { ok: true, place: current } }));
  await page.goto(BASE + "/locator/manage/" + TOKEN, { waitUntil: "networkidle" });
  ok((await page.getByTestId("manage-status").textContent()).includes("Approved. Pay the annual fee"), "verified + unpaid -> pay prompt");
  ok((await page.getByTestId("manage-pay").textContent()).includes("PKR 1,800"), "pay button shows fee");
  await page.screenshot({ path: OUT + "v2-9-manage-unpaid.png", fullPage: true });
  current = place({ verification_status: "pending" });
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.getByTestId("manage-status").textContent()).includes("checking your documents"), "pending -> waiting for check");
  ok((await page.getByTestId("manage-pay").count()) === 0, "no Pay button until verified");
  current = place({ verification_status: "rejected", rejection_reason: "Licence photo unreadable" });
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.textContent("body")).includes("Licence photo unreadable"), "rejection reason shown to owner");
  current = place({ paid_until: "2027-11-09T00:00:00Z", live: true });
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.textContent("body")).includes("You are live on the locator"), "live message");
  { const t = await page.textContent("body"); ok(!/LAST 30 DAYS|Directions taps|Appeared in searches|Call taps|Book taps/i.test(t), "owner page shows no statistics"); }
  const dl = page.waitForEvent("download");
  await page.getByTestId("poster-download").click();
  const d = await dl;
  ok(/\.png$/.test(d.suggestedFilename()), "poster downloads as PNG: " + d.suggestedFilename());
  await d.saveAs(OUT + "v2-poster-sample.png");
  await page.screenshot({ path: OUT + "v2-10-manage-live.png", fullPage: true });
  await page.route("**/api/locator/manage", (r) => r.fulfill({ status: 404, json: { ok: false, error: "not_found" } }));
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.textContent("body")).includes("could not find a listing"), "unknown link message");

  // ---------------------------------------------------------------- payment return
  await page.route("**/api/locator/pay/confirm", (r) => r.fulfill({ json: { ok: true, paid: true, placeName: "Noor Clinic" } }));
  await page.goto(BASE + "/locator/paid?tracker=trk_1", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Payment received");
  ok((await page.getByTestId("paid-result").textContent()).includes("Noor Clinic is now live"), "paid page confirms");
  await page.goto(BASE + "/locator/paid?outcome=cancelled", { waitUntil: "networkidle" });
  ok((await page.textContent("body")).includes("payment was cancelled"), "cancelled page");

  // ---------------------------------------------------------------- real server routes (no DB)
  const post = (path, body) => page.evaluate(async ([p, b]) => { const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, body]);
  const unrouted = await browser.newContext(); const up = await unrouted.newPage(); await up.goto(BASE + "/locator/paid?outcome=cancelled");
  const rp = (path, body) => up.evaluate(async ([p, b]) => { const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, body]);
  let r1 = await rp("/api/locator/apply", { kind: "bogus", name: "X", area: "Y", lat: 24.8, lng: 67, consent: true });
  ok(r1.s === 400 && r1.j.error === "bad_request", "apply rejects an unknown type");
  r1 = await rp("/api/locator/apply", { kind: "clinic", name: "Noor Clinic", area: "Clifton", lat: 31.5, lng: 74.3, consent: true, ownerName: "A B", ownerPhone: "03001234567" });
  ok(r1.j.error === "outside_pilot", "apply rejects a pin outside Karachi");
  r1 = await rp("/api/locator/apply", { kind: "clinic", name: "Noor Clinic", area: "Clifton", lat: 24.8, lng: 67, consent: false, ownerName: "A B", ownerPhone: "03001234567" });
  ok(r1.j.error === "consent_required", "apply needs consent");
  r1 = await rp("/api/locator/apply", { kind: "clinic", name: "Noor Clinic", area: "Clifton", lat: 24.8, lng: 67, consent: true, ownerName: "A", ownerPhone: "1" });
  ok(r1.j.error === "need_contact", "apply needs owner contact");
  r1 = await rp("/api/locator/pay", { token: "short" });
  ok(r1.s === 404, "pay rejects a malformed token");
  r1 = await rp("/api/locator/manage", { token: "zz" });
  ok(r1.s === 404, "manage rejects a malformed token");
  r1 = await rp("/api/locator/phone/send", { phone: "03001234567" });
  ok(r1.j.ok === false && r1.j.error === "unavailable", "phone code says unavailable without an SMS gateway");
  r1 = await rp("/api/locator/report", { placeId: "nope", reason: "closed" });
  ok(r1.s === 400, "report rejects a bad id");
  r1 = await rp("/api/locator/resolve-link", { url: "https://evil.example.com/maps/@24.8,67.0" });
  ok(r1.s === 400 && r1.j.error === "not_a_maps_link", "resolve-link refuses other websites");
  r1 = await rp("/api/locator/resolve-link", { url: "http://maps.google.com/maps/@24.8,67.0" });
  ok(r1.j.error === "not_a_maps_link", "resolve-link refuses plain http");
  r1 = await rp("/api/locator/resolve-link", { url: "https://maps.google.com@evil.example.com/maps" });
  ok(r1.j.error === "not_a_maps_link", "resolve-link refuses the user@host trick");
  r1 = await rp("/api/locator/resolve-link", { url: "https://www.google.com/search?q=x" });
  ok(r1.j.error === "not_a_maps_link", "resolve-link only serves /maps paths");
  r1 = await rp("/api/locator/resolve-link", { url: "https://www.google.com/maps/place/Aga+Khan+Hospital/@24.8918,67.0743,17z/data=!3m1" });
  ok(r1.j.ok === true && Math.abs(r1.j.lat - 24.8918) < 1e-6 && Math.abs(r1.j.lng - 67.0743) < 1e-6, "resolve-link reads a long link without any network call");
  r1 = await rp("/api/locator/resolve-link", { url: "https://www.google.com/maps/place/Aga+Khan+Hospital/data=!4m6!3m5!8m2!3d24.8918!4d67.0743" });
  ok(r1.j.ok === true && Math.abs(r1.j.lat - 24.8918) < 1e-6, "resolve-link reads the !3d!4d pin form");
  r1 = await rp("/api/locator/resolve-link", { url: 12 });
  ok(r1.s === 400, "resolve-link rejects a non-text url");
  const go = await up.evaluate(async () => { const r = await fetch("/api/locator/go/not-a-uuid", { redirect: "manual" }); return r.type; });
  ok(go === "opaqueredirect", "go link with a bad id redirects safely");

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
