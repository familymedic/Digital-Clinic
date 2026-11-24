// Public Locator: Vaccination Centres tile + results + Share on every card + install prompt + app shortcuts.
// Mocked Supabase. Run with the dev server on :3100 (NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co).
const { chromium } = require("playwright");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
const vacc = (id, n, name, d, extra = {}) => ({
  id, category: "vaccination", kind: "vaccination", name, area: "North Nazimabad", address: "Block B", phone: null, notes: "Government health centre",
  doctor_id: null, orientation_date: null, distance_km: d, map_lat: 24.93, map_lng: 67.04, verified: false, verified_on: null, featured: false,
  hours: null, vaccines: null, source_note: null, last_verified: "2026-11-20", vaccine_type: "government", service_fee: false, ...extra,
});
const mon_sat = { days: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat"].map((k) => [k, [["09:00", "14:00"]]])) };
let vaccRows = [
  vacc("v1", 1, "UC-7 Health Centre", 0.6, { hours: mon_sat, vaccines: "BCG, OPV, Pentavalent", phone: "021-1112223", source_note: "District health office list" }),
  vacc("v2", 2, "Sakhi Hassan Dispensary", 1.8, { vaccine_type: "both", service_fee: true }),
  vacc("v3", 3, "Private Vaccine Clinic", 2.4, { vaccine_type: "private", phone: "021-111-911-911" }),
];
// what the real locator_search does: default = government + both; kind 'private' = private + both
const forKind = (rows, kind) => rows.filter((r) => (kind === "private" ? ["private", "both"] : ["government", "both"]).includes(r.vaccine_type ?? "government"));
const doc = (id, n, d) => ({ ...vacc(id, n, "Clinic " + n, d), category: "doctor", kind: "clinic", vaccines: null, last_verified: null });
let fails = 0;
let privCount = 2;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["geolocation"], geolocation: { latitude: 24.93, longitude: 67.04 } });
  const page = await ctx.newPage();
  const calls = [], events = [];
  await page.addInitScript(() => {
    const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
    window.__shared = []; window.__opened = [];
    navigator.share = async (d) => { window.__shared.push(d); };
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  await page.route("**/rest/v1/rpc/locator_counts", (r) => r.fulfill({ json: { live: true, doctor: 3, pharmacy: 0, therapy: 0, autism: 0, vaccination: 2, vaccination_private: privCount } }));
  await page.route("**/rest/v1/rpc/locator_regions_public", (r) => r.fulfill({ json: [{ city: "Karachi", lat: 24.86, lng: 67.01, just_opened: false }] }));
  await page.route("**/rest/v1/rpc/locator_search", async (r) => {
    const b = JSON.parse(r.request().postData() || "{}"); calls.push(b);
    await r.fulfill({ json: b.p_category === "vaccination" ? forKind(vaccRows, b.p_kind) : b.p_category === "doctor" && b.p_kind === "hospital" ? [] : [doc("d1", 1, 0.3), doc("d2", 2, 1.1)] });
  });
  await page.route("**/api/locator/event", async (r) => { events.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ status: 204 }); });

  // ---------------------------------------------------------------- home tile
  await page.goto(BASE + "/locator", { waitUntil: "networkidle" });
  ok(await page.getByTestId("locator-tile-vaccination").isVisible(), "vaccination tile is on the home screen");
  const order = await page.$$eval('[data-testid^="locator-tile-"]', (els) => els.map((e) => e.getAttribute("data-testid").replace("locator-tile-", "")));
  ok(order.join() === "doctor,pharmacy,therapy,autism,vaccination", "five tiles, vaccination last: " + order.join());
  const tb = await page.getByTestId("locator-tile-vaccination").boundingBox();
  const db = await page.getByTestId("locator-tile-doctor").boundingBox();
  ok(tb.width > db.width * 1.8, "vaccination tile spans the full width");
  ok((await page.getByTestId("locator-tile-vaccination").textContent()).includes("2 centres listed"), "tile shows 2 centres listed");
  await page.screenshot({ path: OUT + "v5-1-home.png" });

  // ---------------------------------------------------------------- install prompt on the Locator
  ok((await page.getByTestId("locator-install").count()) === 0, "no install banner until the browser offers install");
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt"); e.prompt = async () => { window.__prompted = 1; }; e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await page.getByTestId("locator-install").waitFor();
  ok((await page.getByTestId("locator-install").textContent()).includes("Keep Find Near Me on your phone"), "Locator install banner appears");
  await page.screenshot({ path: OUT + "v5-2-install.png", fullPage: true });
  await page.getByRole("button", { name: "Install App" }).click();
  ok((await page.evaluate(() => window.__prompted)) === 1, "Install App opens the native install dialog");
  ok((await page.getByTestId("locator-install").count()) === 0, "banner goes away once the install dialog was used");
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt"); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
  });
  await page.getByTestId("locator-install").waitFor();
  await page.getByRole("button", { name: "Not now" }).click();
  ok((await page.getByTestId("locator-install").count()) === 0, "Not now hides the banner");
  ok((await page.evaluate(() => localStorage.getItem("fm_install_locator_dismissed"))) === "1", "Not now is remembered under the Locator's own key (the home page banner is unaffected)");

  // ---------------------------------------------------------------- results
  await page.getByTestId("locator-use-location").first().click();
  await page.waitForTimeout(400);
  await page.getByTestId("locator-tile-vaccination").click();
  await page.waitForSelector('[data-testid="locator-result"]');
  ok(calls.at(-1).p_category === "vaccination", "search asks for category vaccination");
  ok((await page.getByTestId("locator-result").count()) === 2, "two centres shown");
  // card order depends on open/closed at the time of the run, so find cards by name
  const card = (name) => page.getByTestId("locator-result").filter({ hasText: name });
  const c1 = await card("UC-7 Health Centre").textContent();
  ok(c1.includes("UC-7 Health Centre") && c1.includes("Mon to Sat · 9 am to 2 pm"), "card 1 shows the days and times");
  ok(c1.includes("BCG") && c1.includes("OPV") && c1.includes("Pentavalent"), "vaccines shown as tags");
  ok(c1.includes("Listed from health department records, last checked 20 Nov 2026"), "source and last-checked date shown");
  ok(c1.includes("please call first"), "asks to call first when a phone is listed");
  ok(!c1.includes("Book online") && !c1.includes("Featured"), "no booking or featured on vaccination cards");
  ok((await card("UC-7 Health Centre").getByText("Call", { exact: true }).count()) === 1, "Call button when a phone is listed");
  const c2 = await card("Sakhi Hassan Dispensary").textContent();
  ok(c2.includes("Timings not listed"), "card 2 says timings not listed");
  ok(c2.includes("please ask at the centre first"), "card 2 asks to ask at the centre");
  ok(c2.includes("Private vaccines also available") && c2.includes("Small service fee may apply"), "centre with both: 'Private vaccines also available' and fee badge");
  ok(!c1.includes("Private vaccines") && !c1.includes("service fee"), "government-only centre has no private or fee badge");
  ok((await page.getByTestId("locator-result").filter({ hasText: "Private Vaccine Clinic" }).count()) === 0, "private-only centre is not in the default view");
  ok((await page.getByTestId("locator-vacc-scope").textContent()).includes("give government vaccines"), "default view says it shows centres that give government vaccines");
  ok((await page.getByTestId("locator-vacc-note").textContent()).includes("may charge a small service fee"), "general small-fee note under the list");
  ok(calls.at(-1).p_kind === null, "default search sends no kind");
  ok((await page.textContent("body")).includes("Family Medic does not run these centres"), "vaccination disclaimer in the footer");
  ok((await page.getByTestId("locator-list-cta").count()) === 0, "no 'List your workplace' banner on vaccination");
  ok(!(await page.textContent("body")).includes("Govt") && !/\bPrivate\b[^.]{0,20}\bGovernment\b/.test(await page.getByTestId("locator-results-screen").textContent()), "no Govt/Private ownership-style labels");
  // ---- Private vaccines filter
  const chip = page.getByRole("button", { name: "Private vaccines", exact: true });
  ok((await chip.count()) === 1, "a 'Private vaccines' filter chip is shown");
  await chip.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="locator-result"]').length === 2);
  ok(calls.at(-1).p_kind === "private" && calls.at(-1).p_category === "vaccination", "chip searches kind=private");
  const names = await page.$$eval('[data-testid="locator-result"] h3', (e) => e.map((x) => x.textContent));
  ok(names.includes("Sakhi Hassan Dispensary") && names.includes("Private Vaccine Clinic") && !names.includes("UC-7 Health Centre"), "private view lists private-only and both centres");
  const pc = await card("Private Vaccine Clinic").textContent();
  ok(pc.includes("Private vaccines") && !pc.includes("also available") && pc.includes("Listed by Family Medic, last checked 20 Nov 2026"), "private-only card: badge and 'Listed by Family Medic'");
  ok((await page.getByTestId("locator-vacc-scope").textContent()).includes("offer private vaccines"), "private view says what it shows");
  ok((await page.getByTestId("locator-vacc-note").textContent()).includes("Private vaccines are paid"), "private view footer says vaccines are paid and to confirm price");
  await page.screenshot({ path: OUT + "v5-1-private-view.png", fullPage: true });
  await chip.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="locator-result"]').length === 2);
  ok(calls.at(-1).p_kind === null, "tapping the chip again returns to the default view");
  await page.screenshot({ path: OUT + "v5-1-default-view.png", fullPage: true });
  await page.screenshot({ path: OUT + "v5-3-vacc-results.png", fullPage: true });

  // ---------------------------------------------------------------- Share on every card
  ok((await page.getByTestId("locator-share").count()) === 2, "a Share button on every card");
  await card("UC-7 Health Centre").getByTestId("locator-share").click();
  await page.waitForTimeout(150);
  const sh = await page.evaluate(() => window.__shared);
  ok(sh.length === 1 && sh[0].title === "UC-7 Health Centre", "native share sheet opened with the centre name");
  ok(sh[0].text.includes("UC-7 Health Centre (vaccination centre), North Nazimabad") && sh[0].text.includes("Mon to Sat · 9 am to 2 pm") && sh[0].text.includes("Phone: 021-1112223"), "share text has name, area, times and phone");
  ok(sh[0].text.includes("/api/locator/go/v1?s=1"), "share link is the quiet directions link (?s=1)");
  ok(events.some((e) => e.event === "share" && e.category === "vaccination"), "a 'share' event is counted for vaccination");
  ok(!JSON.stringify(events.filter((e) => e.event === "share")).includes("24.9"), "the share count carries no location");
  // no native share (desktop): falls back to WhatsApp
  await page.evaluate(() => { navigator.share = undefined; });
  await card("Sakhi Hassan Dispensary").getByTestId("locator-share").click();
  await page.waitForTimeout(150);
  const op = await page.evaluate(() => window.__opened);
  ok(op.length === 1 && op[0].startsWith("https://wa.me/?text=") && decodeURIComponent(op[0]).includes("Sakhi Hassan Dispensary"), "without a share sheet it opens WhatsApp with the message");
  // closing the share sheet is not an error and does not open WhatsApp
  await page.evaluate(() => { navigator.share = async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }; window.__opened = []; });
  await card("UC-7 Health Centre").getByTestId("locator-share").click();
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => window.__opened)).length === 0, "closing the share sheet does not fall through to WhatsApp");

  // other categories get Share too
  await page.getByTestId("locator-back").click();
  await page.getByTestId("locator-tile-doctor").click();
  await page.waitForSelector('[data-testid="locator-result"]');
  const dc = await page.getByTestId("locator-result").count();
  ok(dc >= 2 && (await page.getByTestId("locator-share").count()) === dc, "Share on every doctor card as well");
  const dText = await page.getByTestId("locator-result").nth(0).textContent();
  ok(!dText.includes("Listed from government records"), "doctor cards do not show the vaccination note");

  // ---------------------------------------------------------------- empty vaccination result
  vaccRows = [];
  await page.getByTestId("locator-back").click();
  await page.getByTestId("locator-tile-vaccination").click();
  await page.waitForSelector('[data-testid="locator-empty"]');
  const em = await page.getByTestId("locator-empty").textContent();
  ok(em.includes("district by district") && em.includes("Lady Health Worker"), "empty vaccination message points to the health centre / LHW");
  ok(!em.includes("List your workplace") && (await page.getByTestId("locator-fallback").count()) === 0, "no 'List your workplace' and no hospital fallback for vaccination");
  ok((await page.getByTestId("locator-see-private").count()) === 1, "empty default view offers 'See centres with private vaccines'");
  await page.getByTestId("locator-see-private").click();
  await page.waitForFunction(() => /private vaccines are listed near you yet/i.test(document.querySelector('[data-testid="locator-empty"]')?.textContent || ""));
  ok(calls.at(-1).p_kind === "private", "the button searches the private view");
  ok((await page.getByTestId("locator-see-private").count()) === 0, "no 'See private' button once already in the private view");
  await page.screenshot({ path: OUT + "v5-1-private-empty.png", fullPage: true });

  // ---------------------------------------------------------------- deep link + shortcuts
  vaccRows = [vacc("v1", 1, "UC-7 Health Centre", 0.6, { hours: mon_sat })];
  privCount = 0;
  await page.goto(BASE + "/locator?tab=vaccination", { waitUntil: "networkidle" });
  ok(await page.getByTestId("locator-results-screen").isVisible(), "/locator?tab=vaccination opens the vaccination screen directly");
  await page.getByTestId("locator-use-location").first().click().catch(() => {});
  await page.waitForSelector('[data-testid="locator-result"]');
  ok((await page.getByRole("button", { name: "Private vaccines", exact: true }).count()) === 0, "no 'Private vaccines' chip when no centre offers private vaccines");
  ok((await page.getByTestId("locator-results-screen").textContent()).includes("Vaccination Centres"), "titled Vaccination Centres");
  const mf = await (await page.request.get(BASE + "/manifest.webmanifest")).json();
  ok(Array.isArray(mf.shortcuts) && mf.shortcuts.length === 4, "app manifest has 4 shortcuts");
  ok(mf.shortcuts.some((s) => s.url === "/locator") && mf.shortcuts.some((s) => s.url === "/locator?tab=vaccination"), "shortcuts: Find near me and Vaccination centres");
  ok(mf.start_url === "/" && mf.display === "standalone", "installed app still starts at the home page");
  await browser.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})();
