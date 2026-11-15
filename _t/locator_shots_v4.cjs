// Screenshots of the new design (mocked data). Run with the dev server on :3100 (Supabase URL any host).
const { chromium } = require("playwright");
const BASE = "http://localhost:3100"; const OUT = process.env.SHOTS || "_t/";
const place = (id, name, d, extra = {}) => ({ id, category: "doctor", kind: "clinic", name, area: "Clifton", address: "Block 2, Clifton", phone: "0300-1112233", notes: "Ground floor, parking available", doctor_id: null, orientation_date: null, distance_km: d, map_lat: 24.815 + d / 200, map_lng: 67.03 + d / 150, verified: false, verified_on: null, featured: false, hours: null, ...extra });
(async () => {
  const browser = await chromium.launch();
  const mk = async (lat, lng) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["geolocation"], geolocation: { latitude: lat, longitude: lng } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); });
    await page.route("**/rest/v1/rpc/locator_counts", (r) => r.fulfill({ json: { live: true, doctor: 24, pharmacy: 9, therapy: 4, autism: 6 } }));
    await page.route("**/rest/v1/rpc/locator_fee_list", (r) => r.fulfill({ json: [] }));
    await page.route("**/rest/v1/rpc/locator_regions_public", (r) => r.fulfill({ json: [{ city: "Karachi", lat: 24.86, lng: 67.01, just_opened: false }, { city: "Sukkur", lat: 27.7, lng: 68.85, just_opened: true }] }));
    await page.route("**/api/locator/event", (r) => r.fulfill({ status: 204 }));
    return { ctx, page };
  };
  const dayKey = ["sun","mon","tue","wed","thu","fri","sat"][new Date(Date.now() + 5 * 3600e3).getUTCDay()];
  const phs = [
    place("p1", "Shifa Pharmacy 24h", 0.5, { category: "pharmacy", kind: "pharmacy", hours: { always: true } }),
    place("p2", "City Medico", 1.1, { category: "pharmacy", kind: "pharmacy", hours: { days: { [dayKey]: [["00:00", "23:59"]] } } }),
    place("p3", "Evening Pharmacy", 1.4, { category: "pharmacy", kind: "pharmacy", hours: { days: {} } }),
  ];
  // 1 home (Karachi)  2 results  3 widened  4 sukkur home with tag  5 fallback
  let { ctx, page } = await mk(24.8138, 67.03);
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click(); await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 560)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n1-home.png" });
  await page.route("**/rest/v1/rpc/locator_search", (r) => r.fulfill({ json: phs }));
  await page.getByTestId("locator-tile-pharmacy").click();
  await page.waitForSelector('[data-testid="locator-result"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 330)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n2-results.png" });
  await page.locator('[data-place="p3"] [data-testid="locator-more"]').click();
  await page.locator('[data-place="p3"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n2b-more.png" });
  await ctx.close();

  ({ ctx, page } = await mk(24.8138, 67.03));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => { const b = JSON.parse(r.request().postData() || "{}"); await r.fulfill({ json: Number(b.p_radius_km) >= 10 ? phs.map((x, i) => ({ ...x, distance_km: 7.8 + i, name: ["Al-Noor Pharmacy", "Care Plus Pharmacy", "Medix Pharmacy"][i], area: "Gulshan-e-Iqbal" })) : [] }); });
  await page.goto(BASE + "/locator?tab=pharmacy", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-widened"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 330)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n3-widened.png" });
  await ctx.close();

  ({ ctx, page } = await mk(27.7052, 68.8574));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => { const b = JSON.parse(r.request().postData() || "{}"); await r.fulfill({ json: b.p_kind === "hospital" ? [place("h", "Sample General Hospital", 12.4, { kind: "hospital", area: "Sukkur" })] : [] }); });
  await page.goto(BASE + "/locator?tab=pharmacy", { waitUntil: "networkidle" });
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForSelector('[data-testid="locator-fallback"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 330)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n4-empty.png" });
  await ctx.close();

  // registration, two steps
  ({ ctx, page } = await mk(24.8138, 67.03));
  await page.route("**/rest/v1/rpc/locator_fee_list", (r) => r.fulfill({ json: [{ kind: "clinic", label: "Clinic", fee_pkr: 1500, requires_verification: true }, { kind: "pharmacy", label: "Pharmacy", fee_pkr: 1000, requires_verification: false }] }));
  await page.goto(BASE + "/locator/list", { waitUntil: "networkidle" });
  await page.getByTestId("list-kind").selectOption("clinic");
  await page.getByTestId("list-name").fill("Noor Family Clinic");
  await page.getByTestId("list-area").selectOption("Clifton");
  await page.getByTestId("list-paste").fill("24.8138, 67.0300"); await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 260)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n5-register1.png" });
  await page.getByTestId("list-next").click(); await page.waitForTimeout(300);
  await page.getByTestId("list-owner-name").fill("Dr. Ali Raza");
  await page.getByTestId("list-owner-phone").fill("0300 1234567");
  await page.getByTestId("list-registration").fill("PMDC 12345-S");
  await page.evaluate(() => window.scrollTo(0, 260)); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "n6-register2.png" });
  await ctx.close();
  await browser.close();
})();
