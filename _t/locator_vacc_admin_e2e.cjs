// Admin "Vaccination centres": add one centre, edit, Excel upload (dry run, commit, undo), CSV with a problem row,
// short Maps link resolution, skipped-rows download. Mocked Supabase + stored admin session.
// Run with SBURL=http://localhost:54399 and the dev server on :3100.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ADMIN = "00000000-0000-0000-0000-00000000a001";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: ADMIN, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`;
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user: { id: ADMIN, aud: "authenticated", role: "authenticated", email: "admin@x.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
const centres = [
  { id: "c1", name: "UC-7 Health Centre", area: "North Nazimabad", district: "Karachi Central", address: "Block B", phone: "021-111", notes: "Government health centre", vaccines: "BCG, OPV", source_note: "DHO list", last_verified: "2026-01-02", vaccine_type: "government", service_fee: false, lat: 24.93, lng: 67.04, hours: { days: { mon: [["09:00", "14:00"]] } }, status: "approved", import_batch: null, created_at: "2026-11-20T00:00:00Z" },
  { id: "c2", name: "Liaquatabad Dispensary", area: "Liaquatabad", district: "Karachi Central", address: null, phone: null, notes: null, vaccines: null, source_note: null, last_verified: "2026-11-20", vaccine_type: "both", service_fee: true, lat: 24.91, lng: 67.05, hours: null, status: "hidden", import_batch: "b1", created_at: "2026-11-21T00:00:00Z" },
];
const batches = [{ id: "b1", label: "Karachi Central · 2026-11-21", rows_added: 5, rows_updated: 1, rows_skipped: 0, created_at: "2026-11-21T00:00:00Z", undone_at: null }];
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const dry = (rows, commit, label) => {
  const results = rows.map((r, i) => (r.lat == null || r.lng == null ? { row: i + 1, name: r.name, status: "error", reason: "no_location" } : { row: i + 1, name: r.name, status: "new", reason: null }));
  const n = (s) => results.filter((x) => x.status === s).length;
  return { committed: commit, batch_id: commit && label ? "b-new" : null, counts: { new: n("new"), update: 0, error: n("error"), duplicate: 0 }, results };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); }, ["sb-localhost-auth-token", JSON.stringify(session)]);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const rpc = [], writes = [], resolves = [], placeGets = [];
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/auth/v1/**", (r) => json(r, session.user));
  await page.route("**/rest/v1/admin_profiles*", (r) => json(r, { id: ADMIN, full_name: "Admin", created_at: "2026-01-01T00:00:00Z" }));
  await page.route("**/rest/v1/locator_places*", async (r) => {
    const m = r.request().method();
    if (m === "GET") { placeGets.push(r.request().url()); return json(r, centres); }
    writes.push({ m, url: r.request().url(), body: r.request().postData() });
    return r.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/locator_import_batches*", (r) => json(r, batches));
  await page.route("**/rest/v1/locator_waitlist*", (r) => json(r, []));
  await page.route("**/rest/v1/locator_fees*", (r) => json(r, []));
  await page.route("**/rest/v1/locator_reports*", (r) => json(r, []));
  await page.route("**/rest/v1/locator_payments*", (r) => json(r, []));
  await page.route("**/rest/v1/rpc/*", async (r) => {
    const name = r.request().url().split("/rpc/")[1].split("?")[0];
    const body = JSON.parse(r.request().postData() || "{}");
    rpc.push({ name, body });
    if (name === "locator_admin_summary") return json(r, { is_live: true, places: { live_doctor: 0, live_pharmacy: 0, live_therapy: 0, live_autism: 0, pending: 0, awaiting_payment: 0, expiring_30d: 0, expired: 0, hidden: 0 }, open_reports: 0, waitlist: 0, revenue_30d: 0, revenue_total: 0, events_7d: { share: 7 }, events_30d: { share: 19 }, by_tab_30d: {}, top_areas_30d: [], top_places_30d: [], waitlist_cities: [] });
    if (name === "locator_admin_vacc_import") return json(r, dry(body.p_rows, body.p_commit, body.p_label));
    if (name === "locator_admin_vacc_undo") return json(r, 5);
    return r.fulfill({ status: 204 });
  });
  await page.route("**/api/admin/locator/resolve-links", async (r) => {
    resolves.push({ auth: r.request().headers()["authorization"], body: JSON.parse(r.request().postData() || "{}") });
    return json(r, { results: resolves.at(-1).body.urls.map(() => ({ lat: 24.9, lng: 67.1 })) });
  });

  // ---------------------------------------------------------------- main Locator admin
  await page.goto(BASE + "/admin/locator", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="admin-vaccination-link"]');
  ok(true, "main Locator admin links to the vaccination page");
  ok(placeGets.some((u) => decodeURIComponent(u).includes("category=neq.vaccination")), "main admin lists leave vaccination centres out");
  ok((await page.textContent("body")).includes("Share taps"), "usage table has a Share taps row");

  // ---------------------------------------------------------------- list
  await page.goto(BASE + "/admin/locator/vaccination", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="vacc-form"]');
  ok((await page.getByTestId("vacc-tab-list").textContent()).includes("All centres (2)"), "tab shows the number of centres");
  await page.getByTestId("vacc-tab-list").click();
  ok((await page.getByTestId("vacc-row").count()) === 2, "both centres listed");
  const t = await page.textContent("body");
  ok(t.includes("Mon to Mon") === false && t.includes("Mon · 9 am to 2 pm"), "hours summary on the list");
  ok(t.includes("worth re-checking"), "a centre last checked over 6 months ago is flagged");
  ok(t.includes("Hidden"), "hidden centre is marked");
  ok(t.includes("Government vaccine") && t.includes("Government and private vaccines") && t.includes("service fee may apply"), "list shows vaccines offered and the service-fee flag");
  await page.getByTestId("vacc-search").fill("liaq");
  ok((await page.getByTestId("vacc-row").count()) === 1, "search filters the list");
  await page.getByTestId("vacc-search").fill("");
  await page.getByRole("button", { name: "Show" }).click();
  await page.waitForTimeout(200);
  ok(writes.some((w) => w.m === "PATCH" && w.body.includes('"approved"')), "Show makes a hidden centre visible again");
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.waitForTimeout(200);
  ok(writes.some((w) => w.m === "DELETE"), "Delete removes a centre after confirmation");

  // ---------------------------------------------------------------- one centre at a time
  await page.getByTestId("vacc-tab-add").click();
  await page.getByTestId("vacc-save").click();
  ok((await page.getByTestId("vacc-error").textContent()).includes("centre name"), "name is required");
  await page.getByTestId("vacc-name").fill("Gulshan EPI Centre");
  await page.getByTestId("vacc-save").click();
  ok((await page.getByTestId("vacc-error").textContent()).includes("area"), "area is required");
  await page.getByTestId("vacc-area").fill("Gulshan-e-Iqbal");
  await page.getByTestId("vacc-save").click();
  ok((await page.getByTestId("vacc-error").textContent()).includes("pin"), "a pin is required");
  await page.getByTestId("vacc-district").fill("Karachi East");
  await page.getByTestId("vacc-vaccines").fill("Routine EPI, 0 to 5 years");
  ok((await page.getByTestId("vacc-type").inputValue()) === "government" && !(await page.getByTestId("vacc-fee").isChecked()), "new centre defaults to Government vaccine, no service fee");
  await page.getByTestId("vacc-type").selectOption("both");
  await page.getByTestId("vacc-fee").check();
  await page.getByTestId("vacc-lat").fill("24.92");
  await page.getByTestId("vacc-lng").fill("67.09");
  await page.screenshot({ path: OUT + "v5-admin-1-add.png", fullPage: true });
  rpc.length = 0;
  await page.getByTestId("vacc-save").click();
  await page.getByTestId("vacc-notice").waitFor();
  const one = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(one && one.body.p_rows.length === 1 && one.body.p_commit === true && one.body.p_label === null, "single centre goes through the import function, committed, no batch");
  ok(one.body.p_rows[0].name === "Gulshan EPI Centre" && one.body.p_rows[0].lat === 24.92 && one.body.p_rows[0].district === "Karachi East", "values sent correctly");
  ok(one.body.p_rows[0].vaccine_type === "both" && one.body.p_rows[0].service_fee === true, "vaccines offered (both) and service fee sent");
  ok((await page.getByTestId("vacc-notice").textContent()).includes("now live"), "says the centre is live (no payment, no review)");
  ok((await page.getByTestId("vacc-name").inputValue()) === "", "form is cleared for the next centre");

  // ---------------------------------------------------------------- edit
  await page.getByTestId("vacc-tab-list").click();
  await page.getByRole("button", { name: "Edit" }).first().click();
  ok((await page.getByTestId("vacc-name").inputValue()) === "UC-7 Health Centre" && (await page.getByTestId("vacc-lat").inputValue()) === "24.93", "edit loads the centre into the form");
  ok((await page.getByTestId("vacc-type").inputValue()) === "government", "edit loads the vaccines-offered value");
  await page.getByTestId("vacc-type").selectOption("private");
  await page.getByTestId("vacc-vaccines").fill("BCG, OPV, Measles");
  rpc.length = 0;
  await page.getByTestId("vacc-save").click();
  await page.getByTestId("vacc-notice").waitFor();
  const upd = rpc.find((c) => c.name === "locator_admin_vacc_update");
  ok(upd && upd.body.p_id === "c1" && upd.body.p_row.vaccines === "BCG, OPV, Measles", "edit calls the update function with the centre id");
  ok(upd.body.p_row.vaccine_type === "private" && upd.body.p_row.service_fee === false, "edit saves the new vaccines-offered value");

  // ---------------------------------------------------------------- Excel upload
  await page.getByTestId("vacc-tab-upload").click();
  ok((await page.getByTestId("vacc-template-xlsx").getAttribute("href")) === "/templates/vaccination-centres-template.xlsx", "Excel template link");
  const tpl = await page.request.get(BASE + "/templates/vaccination-centres-template.xlsx");
  ok(tpl.ok() && (await tpl.body()).length > 3000, "template file is served");
  rpc.length = 0;
  await page.getByTestId("vacc-file").setInputFiles(path.join(__dirname, "fixtures", "vaccination-sample.xlsx"));
  await page.getByTestId("vacc-preview").waitFor();
  const dr = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(dr && dr.body.p_commit === false && dr.body.p_rows.length === 3, "Excel parsed in the browser; dry run sent 3 rows, nothing saved");
  ok(JSON.stringify(dr.body.p_rows[0].hours.days.mon) === '[["09:00","14:00"]]', "time cells read correctly from Excel");
  ok(dr.body.p_rows.every((r) => !("vaccine_type" in r)), "a file with no 'vaccines offered' column sends no vaccine_type (database treats as government)");
  ok((await page.getByTestId("vacc-vtype-default").textContent()).includes("treated as a government vaccine centre"), "preview says a file without that column is treated as government vaccine centres");
  ok(rpc.filter((c) => c.name === "locator_admin_vacc_import" && c.body.p_commit).length === 0, "nothing committed before confirming");
  const pv = await page.getByTestId("vacc-preview").textContent();
  ok(pv.includes("New centres") && pv.includes("Save 3 centre(s)"), "preview shows counts and a Save button");
  ok((await page.getByTestId("vacc-label").inputValue()).startsWith("vaccination-sample"), "upload name pre-filled from the file name");
  await page.screenshot({ path: OUT + "v5-admin-2-preview.png", fullPage: true });
  rpc.length = 0;
  await page.getByTestId("vacc-commit").click();
  await page.getByTestId("vacc-done").waitFor();
  const cm = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(cm && cm.body.p_commit === true && cm.body.p_label.startsWith("vaccination-sample") && cm.body.p_rows.length === 3, "Save commits all rows with the upload name");
  ok((await page.getByTestId("vacc-done").textContent()).includes("3 added"), "result summary shown");

  // the real Karachi Central sheet, cleaned
  rpc.length = 0;
  await page.getByTestId("vacc-file").setInputFiles(path.join(__dirname, "fixtures", "karachi-central-49-clean.xlsx"));
  await page.getByTestId("vacc-preview").waitFor();
  const kc = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(kc && kc.body.p_rows.length === 49 && kc.body.p_rows.every((r) => r.lat && r.lng && r.name), "Karachi Central sheet: 49 centres read, all with a pin");
  ok(kc.body.p_rows[0].area === "Azizabad-6, Gulberg" && JSON.stringify(kc.body.p_rows[0].hours.days.fri) === '[["09:00","12:30"]]', "UC + town as the area, Friday hours kept");
  ok((await page.getByTestId("vacc-preview").textContent()).includes("Save 49 centre(s)"), "preview offers to save 49");
  ok(!(await page.textContent("body")).includes("Columns ignored"), "no column is ignored");
  ok(kc.body.p_rows.every((r) => r.vaccine_type === "government" && r.service_fee === false), "all 49 are Government vaccine, no service fee flagged");
  ok((await page.getByTestId("vacc-vtype-default").count()) === 0, "the 20-column sheet does not show the defaulted notice");
  await page.screenshot({ path: OUT + "v5-admin-4-karachi-central.png", fullPage: true });

  // the private-vaccine centres sheet (AKU, Ziauddin): pins still empty, so the check explains why
  rpc.length = 0;
  await page.getByTestId("vacc-file").setInputFiles(path.join(__dirname, "fixtures", "private-vaccine-centres-aku-ziauddin.xlsx"));
  await page.getByTestId("vacc-preview").waitFor();
  const pr = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(pr && pr.body.p_rows.length === 5 && pr.body.p_rows.every((r) => r.vaccine_type === "private"), "private sheet: 5 centres, all 'private'");
  ok((await page.getByTestId("vacc-vtype-count").textContent()).includes("5"), "preview counts the centres offering private vaccines");
  ok((await page.getByTestId("vacc-preview").textContent()).includes("No usable location"), "missing pins are reported, not guessed");
  await page.screenshot({ path: OUT + "v5-1-admin-private-sheet.png", fullPage: true });

  // ---------------------------------------------------------------- CSV with a problem row + short link
  const csv = [
    "centre_name,district,town_or_uc,latitude,longitude,google_maps_link,opening_time,closing_time,days_open",
    "Good Centre,Karachi Central,Nazimabad,24.91,67.03,,9:00 AM,2:00 PM,Mon-Sat",
    "Linked Centre,Karachi Central,Nazimabad,,,https://maps.app.goo.gl/abc123,8:00 AM,1:00 PM,Mon-Fri",
    "No Pin Centre,Karachi Central,Nazimabad,,,,9:00 AM,2:00 PM,Mon-Sat",
  ].join("\n");
  const csvPath = path.join(require("os").tmpdir(), "vacc-test.csv");
  fs.writeFileSync(csvPath, csv);
  rpc.length = 0;
  await page.getByTestId("vacc-file").setInputFiles(csvPath);
  await page.getByTestId("vacc-preview").waitFor();
  ok(resolves.length === 1 && resolves[0].body.urls.length === 1 && /^Bearer /.test(resolves[0].auth), "short Google Maps link opened through the admin-only route with the session token");
  const dr2 = rpc.find((c) => c.name === "locator_admin_vacc_import");
  ok(dr2.body.p_rows[1].lat === 24.9 && dr2.body.p_rows[1].lng === 67.1, "the resolved pin was used for that row");
  const pv2 = await page.getByTestId("vacc-preview").textContent();
  ok(pv2.includes("No usable location"), "the row without a pin is explained in plain words");
  ok(pv2.includes("Save 2 centre(s)"), "only valid rows are counted for saving");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download skipped rows" }).click();
  const file = await dl;
  const txt = fs.readFileSync(await file.path(), "utf8");
  ok(txt.includes("No Pin Centre") && txt.includes("No usable location") && !txt.includes("Good Centre"), "skipped rows download holds only the problem rows with the reason");
  await page.screenshot({ path: OUT + "v5-admin-3-problems.png", fullPage: true });

  // ---------------------------------------------------------------- wrong file kinds / undo
  fs.writeFileSync(path.join(require("os").tmpdir(), "x.txt"), "hello");
  await page.getByTestId("vacc-file").setInputFiles(path.join(require("os").tmpdir(), "x.txt"));
  await page.waitForTimeout(300);
  ok((await page.getByTestId("vacc-error").textContent()).includes("Excel file (.xlsx)"), "other file types are refused with advice");
  rpc.length = 0;
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  ok(rpc.some((c) => c.name === "locator_admin_vacc_undo" && c.body.p_batch === "b1"), "Undo removes a past upload's added centres");
  await browser.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})();
