// Karachi (incl. Bahria Town) + Hyderabad service areas on the public Locator, plus the server
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
  await page.route("**/rest/v1/rpc/locator_search", async (r) => { calls.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ json: [place("h1")] }); });
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
  ok(cs.includes("Karachi and Hyderabad"), "coming-soon box names the covered cities");
  await ctx.close();

  // Area picker
  ({ page, calls, ctx } = await openAt(browser, 24.8138, 67.03));
  await page.goto(BASE + "/locator?tab=doctor", { waitUntil: "networkidle" });
  const groups = await page.$$eval('[data-testid="locator-area"] optgroup', (els) => els.map((e) => e.getAttribute("label")));
  ok(groups.join() === "Karachi,Hyderabad", "area picker is grouped Karachi / Hyderabad");
  const opts = await page.$$eval('[data-testid="locator-area"] option', (els) => els.map((e) => e.textContent));
  ok(opts.includes("Bahria Town Karachi") && opts.includes("Latifabad") && opts.includes("Jamshoro"), "Bahria Town Karachi and Hyderabad areas are listed");
  await page.getByTestId("locator-area").selectOption("Latifabad");
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(Math.abs(calls[calls.length - 1].p_lat - 25.398) < 1e-6, "picking Latifabad searches around Hyderabad");
  await page.screenshot({ path: OUT + "v3-5-hyderabad-results.png" });
  await page.goto(BASE + "/locator?tab=doctor", { waitUntil: "networkidle" });
  await page.getByTestId("locator-area").selectOption("Bahria Town Karachi");
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(Math.abs(calls[calls.length - 1].p_lng - 67.317) < 1e-6, "picking Bahria Town Karachi searches there");
  ok((await page.textContent("body")).includes("Karachi and Hyderabad"), "page names both cities");
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
  ok(r1.j.error === "outside_pilot", "apply rejects Sukkur (not open yet)");
  r1 = await rp("/api/locator/apply", { ...base, lat: 31.5, lng: 74.3 });
  ok(r1.j.error === "outside_pilot", "apply rejects Lahore");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Hyd Suggest", area: "Latifabad", lat: 25.3950, lng: 68.36, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "need_contact", "suggest accepts a Hyderabad pin");
  r1 = await rp("/api/locator/submit", { category: "doctor", kind: "clinic", name: "Far Suggest", area: "Sukkur", lat: 27.7, lng: 68.86, consent: true, byName: "V", byPhone: "1" });
  ok(r1.j.error === "outside_pilot", "suggest rejects a pin outside the cities");

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
