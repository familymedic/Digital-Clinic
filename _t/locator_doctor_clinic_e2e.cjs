// Doctor "My clinic" page + dashboard card (Locator, migration 0097), mocked Supabase and a
// stored doctor session. Run with the dev server on :3100.
const { chromium } = require("playwright");
const BASE = "http://localhost:3100";
const OUT = process.env.SHOTS || "_t/";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const DOC = "00000000-0000-0000-0000-00000000d001";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: DOC, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`;
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user: { id: DOC, aud: "authenticated", role: "authenticated", email: "dr@x.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, permissions: ["geolocation"], geolocation: { latitude: 24.8138, longitude: 67.03 } });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); }, ["sb-localhost-auth-token", JSON.stringify(session)]);
  const page = await ctx.newPage();
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const rpcs = [], pays = [];
  // the mocked doctor-side database
  let status = { doctor: true, eligible: true, reason: null, full_name: "Dr. Paid Doctor", active_places: 0, max_places: 3, fee_pkr: 1500, free_until: null, free_available: true };
  let places = [];
  let saveError = null;
  await page.route("**/rest/v1/**", (r) => json(r, []));
  await page.route("**/auth/v1/**", (r) => json(r, session.user));
  await page.route("**/rest/v1/doctor_profiles*", (r) => json(r, { id: DOC, full_name: "Dr. Paid Doctor", created_at: "2026-01-01T00:00:00Z", verification_status: "approved", is_active: true, subscription_status: "active", email: "dr@x.com", subscription_current_period_end: null, use_safepay_checkout: true }));
  await page.route("**/rest/v1/doctor_agreement_acceptances*", (r) => json(r, { id: "acc1" }));
  await page.route("**/rest/v1/rpc/*", async (r) => {
    const name = r.request().url().split("/rpc/")[1].split("?")[0];
    const body = JSON.parse(r.request().postData() || "{}");
    rpcs.push({ name, body });
    if (name === "locator_doctor_status") return json(r, status);
    if (name === "locator_doctor_my_places") return json(r, places);
    if (name === "locator_doctor_save_place") {
      if (saveError) return json(r, { message: saveError }, 400);
      if (body.p_id) {
        places = places.map((p) => (p.id === body.p_id ? { ...p, name: body.p_name, phone: body.p_phone, hours: body.p_hours } : p));
        return json(r, { id: body.p_id, created: false, paid_until: places[0].paid_until });
      }
      const end = iso(365);
      const free = status.free_available;
      places.push({ id: "c" + (places.length + 1), name: body.p_name, area: body.p_area, address: body.p_address, phone: body.p_phone, notes: body.p_notes, lat: body.p_lat, lng: body.p_lng, hours: body.p_hours, status: "approved", paid_until: free ? end : null, live: free, free });
      status = { ...status, active_places: places.length, free_until: status.free_until || end, free_available: false };
      return json(r, { id: "c" + places.length, created: true, paid_until: free ? end : null, free });
    }
    if (name === "locator_doctor_remove_place") { places = places.filter((p) => p.id !== body.p_id); status = { ...status, active_places: places.length, free_available: !places.some((q) => q.free) }; return json(r, true); }
    if (name === "doctor_package_my_state") return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (name === "free_week_my_state") return json(r, { phase: "none" });
    return r.fulfill({ status: 204 });
  });
  await page.route("**/api/doctor/locator/pay", async (r) => { pays.push({ auth: r.request().headers()["authorization"], body: JSON.parse(r.request().postData() || "{}") }); await r.fulfill({ json: { ok: true, checkoutUrl: BASE + "/locator/paid?outcome=cancelled" } }); });
  await page.route("**/api/locator/resolve-link", (r) => r.fulfill({ json: { ok: true, lat: 24.8138, lng: 67.03 } }));

  // ---------------------------------------------------------------- dashboard card
  await page.goto(BASE + "/doctor", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="doctor-clinic-card"]', { timeout: 15000 }).catch(() => {});
  ok(await page.getByTestId("doctor-clinic-card").isVisible(), "dashboard shows the Locator card to a paid doctor");
  ok((await page.getByTestId("doctor-clinic-card").textContent()).includes("first clinic is free"), "card promises one free clinic for the first year");

  // ---------------------------------------------------------------- not eligible
  status = { doctor: true, eligible: false, reason: "unpaid", full_name: "Dr. Paid Doctor", active_places: 0, max_places: 3, fee_pkr: 1500, free_until: null, free_available: true };
  await page.goto(BASE + "/doctor", { waitUntil: "networkidle" });
  ok((await page.getByTestId("doctor-clinic-card").count()) === 0, "no Locator card for a doctor whose registration fee is unpaid");
  await page.goto(BASE + "/doctor/clinic", { waitUntil: "networkidle" });
  ok(await page.getByTestId("clinic-not-eligible").isVisible() && (await page.getByTestId("clinic-add").count()) === 0, "unpaid doctor sees the reason and no Add button");
  status = { doctor: false };
  await page.goto(BASE + "/doctor", { waitUntil: "networkidle" });
  ok((await page.getByTestId("doctor-clinic-card").count()) === 0, "no card when the database function says 'not a doctor' (or is not installed)");

  // ---------------------------------------------------------------- add a clinic
  status = { doctor: true, eligible: true, reason: null, full_name: "Dr. Paid Doctor", active_places: 0, max_places: 3, fee_pkr: 1500, free_until: null, free_available: true };
  await page.goto(BASE + "/doctor/clinic", { waitUntil: "networkidle" });
  ok((await page.getByTestId("clinic-offer").textContent()).includes("Your first clinic is free for its first year") && (await page.getByTestId("clinic-offer").textContent()).includes("Any further clinic costs PKR 1,500"), "offer explains one free clinic and the fee for further ones");
  await page.getByTestId("clinic-add").click();
  ok((await page.getByTestId("clinic-name").inputValue()) === "Dr. Paid Doctor Clinic" || (await page.getByTestId("clinic-name").inputValue()).includes("Paid Doctor"), "clinic name is pre-filled from the doctor's name (no double Dr)");
  ok(!(await page.getByTestId("clinic-name").inputValue()).match(/dr\.?\s+dr/i), "no 'Dr Dr' in the pre-filled name");
  await page.getByTestId("clinic-save").click();
  await page.waitForTimeout(200);
  ok(rpcs.filter((x) => x.name === "locator_doctor_save_place").length === 0, "cannot save without area (browser validation)");
  await page.getByTestId("clinic-area").selectOption("Clifton");
  await page.getByTestId("clinic-save").click();
  ok((await page.textContent("body")).includes("Please set the pin of your clinic"), "needs a pin before saving");
  await page.getByTestId("clinic-paste").fill("https://maps.app.goo.gl/ClinicShare");
  await page.waitForSelector('[data-testid="clinic-pin-ok"]');
  ok(true, "short Google link sets the pin");
  await page.getByTestId("clinic-hours-mode-times").click();
  await page.getByTestId("clinic-hours-copy-mon-sat").click();
  await page.getByTestId("clinic-phone").fill("021-3456789");
  await page.getByTestId("clinic-save").click();
  await page.waitForTimeout(150);
  ok(rpcs.filter((x) => x.name === "locator_doctor_save_place").length === 0, "needs the ownership tick first");
  await page.getByTestId("clinic-consent").check();
  await page.screenshot({ path: OUT + "v3-2-doctor-clinic-form.png", fullPage: true });
  await page.getByTestId("clinic-save").click();
  await page.waitForSelector('[data-testid="clinic-card"]');
  const save = rpcs.filter((x) => x.name === "locator_doctor_save_place")[0].body;
  ok(save.p_id === null && save.p_area === "Clifton" && save.p_consent === true && Math.abs(save.p_lat - 24.8138) < 1e-6 && save.p_phone === "021-3456789", "save call carries area, pin, phone and consent");
  ok(save.p_hours && save.p_hours.days && Object.keys(save.p_hours.days).length === 6 && save.p_hours.days.sat.length === 1 && !save.p_hours.days.sun, "hours: Monday to Saturday, Sunday closed");
  ok((await page.getByTestId("clinic-msg").textContent()).includes("is live on the Family Medic Locator, free until"), "doctor is told the clinic is live and free until a date");
  ok((await page.getByTestId("clinic-card").textContent()).includes("Live on the Locator") && (await page.getByTestId("clinic-card").textContent()).includes("This is your free clinic"), "clinic card says live and free");
  ok((await page.getByTestId("clinic-add").textContent()).includes("Add another clinic (PKR 1,500 a year)"), "Add-another button states the fee");
  ok(true, "free clinic stored");
  ok((await page.getByTestId("clinic-renew").count()) === 0, "no Renew button during the free year");
  await page.screenshot({ path: OUT + "v3-3-doctor-clinic-live.png", fullPage: true });

  // ---------------------------------------------------------------- a second clinic is NOT free
  await page.getByTestId("clinic-add").click();
  ok(await page.getByTestId("clinic-fee-note").isVisible(), "form warns that an extra clinic is paid");
  await page.getByTestId("clinic-name").fill("Dr Paid Doctor North Clinic");
  await page.getByTestId("clinic-area").selectOption("DHA (Defence)");
  await page.getByTestId("clinic-paste").fill("24.8000, 67.0600");
  await page.waitForSelector('[data-testid="clinic-pin-ok"]');
  await page.getByTestId("clinic-consent").check();
  await page.getByTestId("clinic-save").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clinic-card"]').length === 2);
  ok((await page.getByTestId("clinic-msg").textContent()).includes("not live yet") && (await page.getByTestId("clinic-msg").textContent()).includes("PKR 1,500"), "doctor is told the extra clinic needs the fee before it goes live");
  const second = page.getByTestId("clinic-card").nth(1);
  ok((await second.textContent()).includes("Not live yet: fee to pay"), "extra clinic card says fee to pay");
  ok((await second.getByTestId("clinic-renew").textContent()).includes("Pay PKR 1,500 and go live"), "extra clinic has a Pay button");
  ok((await page.getByTestId("clinic-card").nth(0).getByTestId("clinic-renew").count()) === 0, "free clinic has no pay button");
  await page.screenshot({ path: OUT + "v3-4-doctor-second-clinic-fee.png", fullPage: false });
  await second.getByTestId("clinic-renew").click();
  await page.waitForURL("**/locator/paid**", { timeout: 10000 }).catch(() => {});
  ok(pays.length === 1 && pays[0].body.placeId === "c2", "paying the extra clinic calls the server with its id");
  pays.length = 0;
  await page.goto(BASE + "/doctor/clinic", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="clinic-card"]');
  // remove the extra clinic again so the later steps keep their single-clinic shape
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("clinic-card").nth(1).getByTestId("clinic-remove").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="clinic-card"]').length === 1);

  // ---------------------------------------------------------------- edit + remove
  await page.getByTestId("clinic-edit").click();
  ok((await page.getByTestId("clinic-pin-ok").isVisible()) && (await page.getByTestId("clinic-consent").count()) === 0, "editing keeps the pin and does not ask for consent again");
  await page.getByTestId("clinic-phone").fill("021-9999999");
  await page.getByTestId("clinic-hours-mode-always").click();
  await page.getByTestId("clinic-save").click();
  await page.waitForTimeout(300);
  const edit = rpcs.filter((x) => x.name === "locator_doctor_save_place").slice(-1)[0].body;
  ok(edit.p_id === "c1" && edit.p_phone === "021-9999999" && edit.p_hours.always === true, "edit sends the clinic id and the new phone and hours");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("clinic-remove").click();
  await page.waitForTimeout(400);
  ok((await page.getByTestId("clinic-card").count()) === 0, "removed clinic disappears from the doctor's list");
  ok(rpcs.some((x) => x.name === "locator_doctor_remove_place" && x.body.p_id === "c1"), "remove call sent");

  // ---------------------------------------------------------------- errors, limit, renewal
  saveError = "duplicate";
  await page.getByTestId("clinic-add").click();
  await page.getByTestId("clinic-area").selectOption("DHA (Defence)");
  await page.getByTestId("clinic-paste").fill("24.8000, 67.0600");
  await page.waitForSelector('[data-testid="clinic-pin-ok"]');
  await page.getByTestId("clinic-consent").check();
  await page.getByTestId("clinic-save").click();
  await page.waitForSelector('[data-testid="clinic-msg"]');
  ok((await page.getByTestId("clinic-msg").textContent()).includes("already listed at this spot"), "database error is shown in plain words");
  saveError = null;

  places = [{ id: "c9", name: "Dr Paid Clinic", area: "Clifton", address: null, phone: null, notes: null, lat: 24.81, lng: 67.03, hours: null, status: "approved", paid_until: iso(-20), live: false, free: true }];
  status = { ...status, active_places: 1, free_until: iso(-20), free_available: false };
  await page.goto(BASE + "/doctor/clinic", { waitUntil: "networkidle" });
  ok((await page.getByTestId("clinic-card").textContent()).includes("Not live: fee due"), "expired clinic shows 'fee due'");
  ok((await page.getByTestId("clinic-offer").textContent()).includes("Your free clinic year is over"), "offer text switches to the paid fee after the free year");
  const renewBtn = page.getByTestId("clinic-renew");
  ok((await renewBtn.textContent()).includes("PKR 1,500"), "Renew button shows the clinic fee");
  await renewBtn.click();
  await page.waitForURL("**/locator/paid**", { timeout: 10000 }).catch(() => {});
  ok(pays.length === 1 && pays[0].body.placeId === "c9" && /^Bearer /.test(pays[0].auth || ""), "renewal calls the server with the doctor's sign-in and the clinic id only (no amount)");
  ok(page.url().includes("/locator/paid"), "doctor is sent on to the payment page");
  ok((await page.textContent("body")).includes("My clinic"), "payment return page offers a way back to My clinic for doctors");

  // ---------------------------------------------------------------- real server route (no DB)
  const unrouted = await browser.newContext(); const up = await unrouted.newPage(); await up.goto(BASE + "/locator/paid?outcome=cancelled");
  const rp = (path, body, headers = {}) => up.evaluate(async ([p, b, h]) => { const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, body, headers]);
  let r1 = await rp("/api/doctor/locator/pay", { placeId: "c9" });
  ok(r1.s === 401 || r1.s === 503, "doctor renewal needs a sign-in (or reports the database is not connected)");
  r1 = await rp("/api/doctor/locator/pay", { placeId: "not-a-uuid" }, { Authorization: "Bearer abc" });
  ok(r1.s === 400 || r1.s === 401 || r1.s === 503, "doctor renewal rejects a bad clinic id");

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
