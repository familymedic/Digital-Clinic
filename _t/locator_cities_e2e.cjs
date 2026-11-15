// Karachi (incl. Bahria Town and DHA City), Hyderabad, Jamshoro, Sukkur, Khairpur and Larkana service areas on the public Locator, plus the server
// route that checks pins. Run with the dev server on :3100.
const { chromium } = require("playwright");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const place = (id) => ({ id, category: "doctor", kind: "clinic", name: "Test " + id, area: "Latifabad", address: null, phone: "021-111", notes: null, doctor_id: null, orientation_date: null, distance_km: 1.2, map_lat: 25.4, map_lng: 68.36, verified: true, verified_on: "2026-11-01", featured: false, hours: null });

async function openAt(browser, lat, lng) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: lat, longitude: lng } });
  const page = await ctx.newPage();
  const calls = [];
  await page.addInitScript(() => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); });
  await page.route("**/rest/v1/rpc/locator_counts", (r) => r.fulfill({ json: { live: true, doctor: 3, pharmacy: 1, therapy: 1, autism: 2 } }));
  await page.route("**/rest/v1/rpc/locator_fee_list", (r) => r.fulfill({ json: [] }));
  await page.route("**/rest/v1/rpc/locator_regions_public", (r) => r.fulfill({ json: [
    { city: "Karachi", lat: 24.86, lng: 67.01, just_opened: false },
    { city: "Hyderabad", lat: 25.38, lng: 68.37, just_opened: true },
    { city: "Sukkur", lat: 27.7, lng: 68.85, just_opened: true },
  ] }));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => { calls.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ json: [place("h1"), place("h2"), place("h3")] }); });
  await page.route("**/api/locator/event", (r) => r.fulfill({ status: 204 }));
  await page.route("**/rest/v1/rpc/locator_waitlist*", (r) => r.fulfill({ json: true }));
  return { page, calls, ctx };
}

(async () => {
  const browser = await chromium.launch();

  // Hyderabad GPS
  let { page, calls, ctx } = await openAt(browser, 25.39, 68.36);
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-tile-doctor").click();
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-result"]', { timeout: 10000 });
  ok(calls.length === 1 && Math.abs(calls[0].p_lat - 25.39) < 1e-6, "GPS in Hyderabad is accepted and searched");
  ok((await page.getByTestId("locator-coming-soon").count()) === 0, "no 'coming soon' for Hyderabad");
  await ctx.close();

  // Bahria Town (far north-east edge)
  ({ page, calls, ctx } = await openAt(browser, 25.06, 67.52));
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-tile-doctor").click();
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-result"]', { timeout: 10000 });
  ok(calls.length === 1, "GPS at the far edge of Bahria Town is accepted as Karachi");
  await ctx.close();

  // Lahore
  ({ page, calls, ctx } = await openAt(browser, 31.5, 74.3));
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-tile-doctor").click();
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-coming-soon"]', { timeout: 10000 });
  ok(calls.length === 0, "GPS in Lahore does not search");
  const cs = await page.getByTestId("locator-coming-soon").textContent();
  ok(cs.includes("Karachi, Hyderabad, Jamshoro, Sukkur, Khairpur and Larkana"), "coming-soon box names the covered cities");
  ok(!/pilot/i.test(await page.textContent("body")), "no 'pilot' wording on the page");
  await ctx.close();

  // Area picker
  ({ page, calls, ctx } = await openAt(browser, 24.8138, 67.03));
  await page.goto(BASE + "/locator?tab=doctor", { waitUntil: "networkidle" });
  const groups = await page.$$eval('[data-testid="locator-area"] optgroup', (els) => els.map((e) => e.getAttribute("label")));
  ok(groups.join() === "Karachi,Hyderabad,Jamshoro,Sukkur,Khairpur,Larkana", "area picker is grouped by the six cities");
  const opts = await page.$$eval('[data-testid="locator-area"] option', (els) => els.map((e) => e.textContent));
  ok(opts.includes("Bahria Town Karachi") && opts.includes("DHA City Karachi") && opts.includes("Latifabad") && opts.includes("Jamshoro City") && opts.includes("Sukkur City") && opts.includes("Khairpur City") && opts.includes("Larkana City"), "Bahria, DHA City and the Sindh city areas are listed");
  await page.getByTestId("locator-area").selectOption("Latifabad");
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(Math.abs(calls[calls.length - 1].p_lat - 25.398) < 1e-6, "picking Latifabad searches around Hyderabad");
  await page.screenshot({ path: OUT + "v3-5-hyderabad-results.png" });
  await page.goto(BASE + "/locator?tab=doctor", { waitUntil: "networkidle" });
  await page.getByTestId("locator-area").selectOption("Bahria Town Karachi");
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(Math.abs(calls[calls.length - 1].p_lng - 67.317) < 1e-6, "picking Bahria Town Karachi searches there");
  ok((await page.textContent("body")).includes("Karachi, Hyderabad, Jamshoro, Sukkur, Khairpur and Larkana"), "page names the cities");
  await ctx.close();

  // Sukkur GPS: accepted, and the city is tagged "just opened"
  ({ page, calls, ctx } = await openAt(browser, 27.7052, 68.8574));
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-just-opened"]', { timeout: 10000 });
  ok((await page.getByTestId("locator-just-opened").textContent()).includes("Just opened in Sukkur"), "Sukkur shows the 'Just opened' tag");
  await page.getByTestId("locator-tile-doctor").click();
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(calls.length === 1 && Math.abs(calls[0].p_lat - 27.7052) < 1e-6, "GPS in Sukkur is accepted and searched");
  await ctx.close();

  // Karachi GPS: no 'just opened' tag
  ({ page, calls, ctx } = await openAt(browser, 24.8138, 67.03));
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForTimeout(600);
  ok((await page.getByTestId("locator-just-opened").count()) === 0, "Karachi has no 'Just opened' tag");
  await ctx.close();

  // Automatic widening: nothing under 10 km, so the page goes 3 > 5 > 10 and says so
  ({ page, calls, ctx } = await openAt(browser, 24.8138, 67.03));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => {
    const b = JSON.parse(r.request().postData() || "{}"); calls.push(b);
    await r.fulfill({ json: Number(b.p_radius_km) >= 10 ? [place("w1"), place("w2"), place("w3")] : [] });
  });
  await page.goto(BASE + "/locator?tab=pharmacy", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-widened"]', { timeout: 10000 });
  ok(calls.map((c) => c.p_radius_km).join() === "3,5,10", "search widens by itself: 3, 5, 10 km (" + calls.map((c) => c.p_radius_km).join() + ")");
  ok((await page.getByTestId("locator-widened").textContent()).includes("Nothing within 3 km, so we widened to 10 km"), "says what it did");
  ok((await page.getByTestId("locator-search-wider").textContent()).includes("20 km"), "'Search wider' offers 20 km");
  await page.screenshot({ path: OUT + "v4-widened.png", fullPage: true });
  await page.getByTestId("locator-search-wider").click();
  await page.waitForTimeout(300);
  ok(calls[calls.length - 1].p_radius_km === 20, "Search wider re-searches at 20 km");
  await ctx.close();

  // Still nothing at 30 km: nearest hospital + a way forward
  ({ page, calls, ctx } = await openAt(browser, 27.7052, 68.8574));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => {
    const b = JSON.parse(r.request().postData() || "{}"); calls.push(b);
    await r.fulfill({ json: b.p_kind === "hospital" ? [{ ...place("hos1"), kind: "hospital", name: "Sample General Hospital", distance_km: 12.4, phone: "0300-1112233" }] : [] });
  });
  await page.goto(BASE + "/locator?tab=pharmacy", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-empty"]', { timeout: 10000 });
  ok(calls.filter((c) => c.p_kind !== "hospital").map((c) => c.p_radius_km).join() === "3,5,10,20,30", "widens all the way to 30 km");
  ok((await page.getByTestId("locator-empty").textContent()).includes("Nothing listed within 30 km yet"), "says nothing within 30 km");
  ok((await page.getByTestId("locator-fallback").textContent()).includes("Sample General Hospital"), "shows the nearest hospital instead of a dead end");
  ok((await page.getByTestId("locator-search-wider").count()) === 0, "no 'Search wider' past 30 km");
  await page.screenshot({ path: OUT + "v4-empty-fallback.png", fullPage: true });
  await ctx.close();

  // Server route: pins
  const unrouted = await browser.newContext(); const up = await unrouted.newPage(); await up.goto(BASE + "/locator/paid?outcome=cancelled");
  const rp = (path, body) => up.evaluate(async ([p, b]) => { const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, body]);
  const base = { kind: "clinic", name: "Noor Clinic", area: "Clifton", consent: true, ownerName: "A", ownerPhone: "1" };
  let r1 = await rp("/api/locator/apply", { ...base, lat: 25.06, lng: 67.52 });
  ok(r1.j.error === "need_contact", "apply accepts a Bahria Town pin (reaches the next check)");
  r1 = await rp("/api/locator/apply", { ...base, lat: 25.3792, lng: 68.3683 });
  ok(r1.j.error === "need_contact", "apply accepts a Hyderabad pin");
  r1 = await rp("/api/locator/apply", { ...base, lat: 27.7, lng: 68.86 });
  ok(r1.j.error === "need_contact", "apply accepts a Sukkur pin");
  r1 = await rp("/api/locator/apply", { ...base, lat: 27.557, lng: 68.2141 });
  ok(r1.j.error === "need_contact", "apply accepts a Larkana pin");
  r1 = await rp("/api/locator/apply", { ...base, lat: 31.5, lng: 74.3 });
  ok(r1.j.error === "outside_pilot", "apply rejects Lahore");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Hyd Suggest", area: "Latifabad", lat: 25.3950, lng: 68.36, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "need_contact", "suggest accepts a Hyderabad pin");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Far Suggest", area: "Lahore", lat: 31.5, lng: 74.3, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "outside_pilot", "suggest rejects a pin outside the cities");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Khairpur Suggest", area: "Khairpur City", lat: 27.5295, lng: 68.7592, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "need_contact", "suggest accepts a Khairpur pin");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Jamshoro Suggest", area: "Jamshoro City", lat: 25.4296, lng: 68.28, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "need_contact", "suggest accepts a Jamshoro pin");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Thar Suggest", area: "Thar", lat: 24.0, lng: 71.0, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "outside_pilot", "suggest rejects a point between the cities");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Sukkur Suggest", area: "Sukkur City", lat: 27.7, lng: 68.86, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "need_contact", "suggest accepts a Sukkur pin");

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
