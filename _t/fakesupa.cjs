/* A small stand-in for Supabase (auth + PostgREST) so the real Next.js app can be driven end to end in a browser. */
const http = require("http");
const crypto = require("crypto");

const PORT = 54398;
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const uuid = () => crypto.randomUUID();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (u) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.sig`;
const subOf = (tok) => {
  try { return JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).sub; } catch { return null; }
};

const DOC = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const state = {
  users: [],
  family_members: [],
  guest_access: [],
  consultations: [],
  access_throttle: [],
  slots: [
    { id: "s1", doctor_id: DOC, start_time: iso(Date.now() + 2 * DAY), capacity: 1 },
    { id: "s2", doctor_id: DOC, start_time: iso(Date.now() + 3 * DAY), capacity: 1 },
  ],
  directory: [
    { id: DOC, full_name: "Dr Test Doctor", specialty: "Family Medicine", consultation_fee: 800 },
    { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", full_name: "Dr Second", specialty: "Dermatology", consultation_fee: 1000 },
  ],
  textStatus: { configured: true, is_open: true, remaining: 5, start_time: "09:00:00", end_time: "21:00:00" },
  capacity: { daily_cap: 20, today_count: 1, remaining: 19, is_full: false },
  slotsFail: false,
  log: [],
  doctorIds: [],
  messages: [],
  noReplyCol: false,
  feedback: [],
  noRatings: false,
  fw: null,
  popups: [],
  popupsMissing: false,
  habit: null,
  uploads: [],
  removed: [],
};
function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }

function habitFresh() {
  return {
    settings: { game_live: true, league_live: true, show_counts: false, min_entries: 100, auto_publish: false, league_min_entries: 10 },
    views: { visit: { today: 5, d7: 40, d30: 120 }, start: { today: 3, d7: 28, d30: 80 }, complete: { today: 2, d7: 20, d30: 60 } },
    catalog: [
      { id: 1, name: "Gujrat", province: "Punjab", is_active: true },
      { id: 2, name: "Gujranwala", province: "Punjab", is_active: true },
      { id: 3, name: "Karachi", province: "Sindh", is_active: true },
      { id: 4, name: "Peshawar", province: "Khyber Pakhtunkhwa", is_active: true },
      { id: 5, name: "Hidden Town", province: "Sindh", is_active: false },
    ],
    league: [
      { city_id: 1, name: "Gujrat", province: "Punjab", avg: 64.2, prev_avg: 60.1, delta: 4.1 },
      { city_id: 3, name: "Karachi", province: "Sindh", avg: 58.5, prev_avg: 60, delta: -1.5 },
    ],
    leagueCounts: { 1: 37, 3: 412 },
    winners: [{ week_start: "2026-10-12", best: { name: "Gujrat", province: "Punjab", score: 64.2 }, improved: { name: "Karachi", province: "Sindh", delta: 3.2 } }],
    draft: { week_start: "2026-10-12", min_entries: 100, best: { name: "Gujrat", province: "Punjab", score: 64.2 }, improved: null, published: false },
    stats: { from: "2026-10-17", to: "2026-10-23", events: { visit: 120, start: 80, complete: 60, returning: 15, share: 9, doctor_tap: 4, channel_tap: 2 },
      cities: [{ city_id: 1, name: "Gujrat", province: "Punjab", entries: 37, avg_score: 64.2, female: 20, male: 15, unsaid: 2 }], daily: [{ day: "2026-10-22", completes: 30 }, { day: "2026-10-23", completes: 30 }] },
    submits: [], events: [], saves: [], published: [], unpublished: [], cityAdds: [], cityToggles: [], submitFail: false,
  };
}
function fwFresh(phase) {
  return {
    phase, name: "Free Family Consultation Week", opens_on: ymd(Date.now() - 3 * DAY), starts_on: ymd(Date.now()), ends_on: ymd(Date.now() + 4 * DAY),
    credits: 3, modes: ["text", "audio"], members: [], claims: [], optedDoctors: [{ doctor_id: DOC, cap: 5 }],
    slots: [{ id: "fs1", doctor_id: DOC, start_time: iso(Date.now() + DAY) }, { id: "fs2", doctor_id: DOC, start_time: iso(Date.now() + DAY + 300000) }],
    docOpt: { opted_in: false, cap: 5 }, saved: null, addCalls: [], optCalls: [],
  };
}
const normPhone = (t) => { t = String(t || "").trim(); if (!t) return null; const plus = t.startsWith("+"); let d = t.replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); else if (!plus && d.startsWith("0") && d.length === 11) d = "92" + d.slice(1); else if (!plus && d.length === 10 && d.startsWith("3")) d = "92" + d; if (d.length < 10 || d.length > 15) return null; if (d.startsWith("92") && d.length !== 12) return null; return d; };

function userJson(u) { return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.user_metadata, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" }; }
function slotsOut() {
  return state.slots
    .map((s) => ({ ...s, remaining: s.capacity - state.consultations.filter((c) => c.slot_id === s.id && c.status !== "cancelled").length }))
    .filter((s) => s.remaining > 0);
}
function lastEnd(accountId) {
  const mine = state.family_members.filter((m) => m.account_id === accountId).map((m) => m.id);
  let best = null;
  for (const c of state.consultations.filter((c) => mine.includes(c.patient_id))) {
    const slot = state.slots.find((s) => s.id === c.slot_id);
    const created = new Date(c.created_at).getTime();
    const end = Math.max(created + DAY, (slot ? new Date(slot.start_time).getTime() : created) + 3600000);
    if (best == null || end > best) best = end;
  }
  return best == null ? null : iso(best);
}
function thr(k) { return state.access_throttle.find((x) => x.key === k); }
function bump(key, w) {
  let r = thr(key); const now = Date.now();
  if (!r) { r = { key, fail_count: 1, window_start: now, locked_until: null }; state.access_throttle.push(r); }
  else if (r.window_start < now - w * 1000) { r.fail_count = 1; r.window_start = now; }
  else r.fail_count += 1;
  return r;
}

function filtersOf(url) {
  const f = [];
  url.searchParams.forEach((v, k) => {
    if (["select", "order", "limit", "offset"].includes(k)) return;
    const [op, ...rest] = v.split(".");
    f.push({ col: k, op, val: rest.join(".") });
  });
  return f;
}
const ok = (row, f) => { const c = row[f.col]; if (f.op === "eq") return String(c) === f.val; if (f.op === "not") return f.val === "is.null" ? c != null : true; return true; };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    const method = req.method;
    const raw = Buffer.concat(chunks).toString();
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const accept = req.headers["accept"] || "";
    const obj = accept.includes("vnd.pgrst.object");
    const bearer = (req.headers["authorization"] || "").replace("Bearer ", "");
    const isService = bearer === "svc-key";
    const authedId = bearer.includes(".") ? subOf(bearer) : null;
    const cors = {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Expose-Headers": "content-range",
    };
    const send = (status, b) => { res.writeHead(status, { "Content-Type": "application/json", ...cors }); res.end(b === undefined ? "" : JSON.stringify(b)); };
    if (method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const ONE = (row) => (obj ? (row ? send(200, row) : send(406, { code: "PGRST116", message: "0 rows", details: "0 rows", hint: null })) : send(200, row ? [row] : []));

    // ---- control
    if (p === "/__fw") { state.fw = body && body.phase ? fwFresh(body.phase) : null; if (state.fw && body.patch) Object.assign(state.fw, body.patch); return send(200, {}); }
    if (p === "/__popups") { if (body && Array.isArray(body.rows)) state.popups = body.rows; if (body && "missing" in body) state.popupsMissing = !!body.missing; return send(200, { popups: state.popups, uploads: state.uploads, removed: state.removed }); }
    if (p === "/__popupstate") return send(200, { popups: state.popups, uploads: state.uploads, removed: state.removed });
    if (p === "/__habit") { if (body && body.reset) state.habit = habitFresh(); if (!state.habit) state.habit = habitFresh(); if (body && body.patch) Object.assign(state.habit, body.patch); if (body && body.settings) Object.assign(state.habit.settings, body.settings); return send(200, {}); }
    if (p === "/__habitstate") return send(200, state.habit || {});
    if (p === "/__fwstate") return send(200, { fw: state.fw, saved: state.fwSaved || null, consultations: state.consultations });
    if (p === "/__fb") return send(200, state.feedback);
    if (p === "/__state") return send(200, { users: state.users.map((u) => ({ id: u.id, email: u.email, password: u.password, user_metadata: u.user_metadata })), family_members: state.family_members, guest_access: state.guest_access, consultations: state.consultations, access_throttle: state.access_throttle, messages: state.messages });
    if (p === "/__set") { Object.assign(state, body || {}); return send(200, {}); }
    if (p === "/__consultation") {
      const c = state.consultations.find((x) => x.id === url.searchParams.get("id"));
      if (c) Object.assign(c, JSON.parse(url.searchParams.get("patch") || "{}"));
      return send(200, c || {});
    }
    if (p === "/__reset") {
      state.users.length = 0; state.family_members.length = 0; state.guest_access.length = 0; state.consultations.length = 0; state.access_throttle.length = 0; state.messages.length = 0; state.noReplyCol = false; state.feedback.length = 0; state.noRatings = false; state.adminIds = [];
      state.slotsFail = false; state.fw = null; state.doctorIds = []; state.popups = []; state.popupsMissing = false; state.uploads = []; state.removed = [];
      return send(200, {});
    }

    // ---- auth
    if (p === "/auth/v1/token" && method === "POST") {
      const u = state.users.find((x) => x.email === body.email && x.password === body.password);
      if (!u) return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      const t = jwt(u);
      return send(200, { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + u.id, user: userJson(u) });
    }
    if (p === "/auth/v1/user") {
      const u = state.users.find((x) => x.id === authedId);
      return u ? send(200, userJson(u)) : send(401, { msg: "bad jwt" });
    }
    if (p === "/auth/v1/admin/users" && method === "POST") {
      if (state.users.some((u) => u.email === body.email)) return send(422, { msg: "already registered" });
      const u = { id: uuid(), email: body.email, password: body.password, user_metadata: body.user_metadata || {} };
      state.users.push(u);
      state.family_members.push({ id: uuid(), account_id: u.id, full_name: u.user_metadata.full_name, relationship: "self", is_guest: false, guest_created_at: null, guest_converted_at: null, anonymized_at: null, created_at: iso(Date.now()) });
      return send(200, userJson(u));
    }
    const adm = p.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adm) {
      const u = state.users.find((x) => x.id === adm[1]);
      if (method === "GET") return u ? send(200, userJson(u)) : send(404, { msg: "nf" });
      if (method === "PUT") { if (!u) return send(404, { msg: "nf" }); if (body.password) u.password = body.password; return send(200, userJson(u)); }
      if (method === "DELETE") { state.users = state.users.filter((x) => x.id !== adm[1]); return send(200, {}); }
    }

    // ---- habit age (migration 0084): canned answers; the real maths is tested against Postgres
    if (state.habit) {
      const H = state.habit;
      const hr = p.match(/^\/rest\/v1\/rpc\/(habit_[a-z_]+)$/);
      const adminOnly = () => ((state.adminIds || []).includes(authedId) ? null : send(400, { message: "not_admin" }));
      if (hr && method === "POST") {
        const n = hr[1];
        if (n === "habit_public_league") {
          const cities = H.settings.league_live ? H.league.map((c) => (H.settings.show_counts ? { ...c, entries: H.leagueCounts[c.city_id] } : c)) : [];
          return send(200, H.settings.game_live ? { game_live: true, league_live: H.settings.league_live, show_counts: H.settings.show_counts, min_entries: H.settings.min_entries, league_min: H.settings.league_min_entries, cities } : { game_live: false, league_live: false, show_counts: false, min_entries: H.settings.min_entries, cities: [] });
        }
        if (n === "habit_public_winners") return send(200, H.settings.league_live ? H.winners : []);
        if (n === "habit_submit") {
          if (!isService) return send(401, { message: "permission denied for function habit_submit" });
          if (H.submitFail) return send(400, { message: "boom" });
          if (!H.settings.game_live) return send(400, { message: "game_off" });
          H.submits.push(body); return send(200, { score: 50, city_id: body.p_city_id || 0 });
        }
        if (n === "habit_event") { if (!isService) return send(401, { message: "permission denied for function habit_event" }); H.events.push(body.p_event); return send(204); }
        if (n === "habit_admin_get") return adminOnly() || send(200, H.settings);
        if (n === "habit_admin_save") { const a = adminOnly(); if (a) return a; if (!(body.p_min_entries >= 1)) return send(400, { message: "bad_min_entries" }); H.saves.push(body); Object.assign(H.settings, { game_live: body.p_game_live, league_live: body.p_league_live, show_counts: body.p_show_counts, min_entries: body.p_min_entries, auto_publish: body.p_auto_publish }); if (body.p_league_min_entries !== undefined) { if (!(body.p_league_min_entries >= 1)) return send(400, { message: "bad_league_min" }); H.settings.league_min_entries = body.p_league_min_entries; } return send(204); }
        if (n === "habit_admin_stats") return adminOnly() || send(200, H.stats);
        if (n === "habit_admin_views") return adminOnly() || send(200, H.views);
        if (n === "habit_admin_winner_draft") return adminOnly() || send(200, H.draft);
        if (n === "habit_admin_publish_winners") { const a = adminOnly(); if (a) return a; H.published.push(body.p_week); H.draft.published = true; return send(204); }
        if (n === "habit_admin_unpublish_winners") { const a = adminOnly(); if (a) return a; H.unpublished.push(body.p_week); H.draft.published = false; return send(204); }
      }
      if (p === "/rest/v1/habit_cities") {
        if (method === "GET") {
          const admin = (state.adminIds || []).includes(authedId);
          const rows = H.catalog.filter((c) => admin || c.is_active).map((c) => ({ id: c.id, name: c.name, province: c.province, is_active: c.is_active }));
          return send(200, rows);
        }
        if (method === "POST") { if (!(state.adminIds || []).includes(authedId)) return send(403, { message: "new row violates row-level security policy" }); if (H.catalog.some((c) => c.name.toLowerCase() === String(body.name).toLowerCase() && c.province === body.province)) return send(409, { message: "duplicate key value violates unique constraint" }); H.cityAdds.push(body); H.catalog.push({ id: 100 + H.cityAdds.length, is_active: true, ...body }); return send(201); }
        if (method === "PATCH") { if (!(state.adminIds || []).includes(authedId)) return send(200, []); const id = Number((url.searchParams.get("id") || "").replace("eq.", "")); H.cityToggles.push({ id, ...body }); H.catalog.filter((c) => c.id === id).forEach((c) => Object.assign(c, body)); return send(204); }
      }
      if (p === "/rest/v1/habit_winners" && method === "GET") return send(200, H.draft.published ? [{ week_start: H.draft.week_start }] : []);
    }

    // ---- rpc
    const rpc = p.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      const n = rpc[1];

      if (n.startsWith("free_week_") || n.startsWith("admin_free_week_")) {
        const fw = state.fw;
        const me = state.users.find((u) => u.id === authedId);
        const isGuest = !!me && (String(me.email).startsWith("guest.") || state.family_members.some((m) => m.account_id === me.id && m.is_guest));
        const live = fw && (fw.phase === "preregister" || fw.phase === "open");
        const used = () => (fw && authedId ? fw.claims.filter((c) => c.account_id === authedId && c.status !== "cancelled").length : 0);
        const err = (m) => send(400, { message: m });
        if (n === "free_week_status") {
          if (!fw || !live) return send(200, { phase: "none" });
          return send(200, { phase: fw.phase, name: fw.name, opens_on: fw.opens_on, starts_on: fw.starts_on, ends_on: fw.ends_on, credits_per_account: fw.credits, modes: fw.modes, signed_in: !!me, is_guest: isGuest, enrolled: !!authedId && fw.members.some((m) => m.account_id === authedId), credits_used: used(), credits_left: Math.max(fw.credits - used(), 0), phone_on_file: (me && me.user_metadata.phone) || null });
        }
        if (n === "free_week_enrol") {
          if (!authedId) return err("Please log in or create an account first.");
          if (!live) return err("Registration for the free week is not open right now.");
          if (isGuest) return err("Free consultations are for registered accounts. Please create a free account first.");
          const norm = normPhone(body.p_phone);
          if (!norm) return err("Please enter a valid mobile number, for example 0300 1234567.");
          const ex = fw.members.find((m) => m.account_id === authedId);
          if (ex) { ex.consent = !!body.p_marketing_consent; return send(204); }
          if (fw.members.some((m) => m.phone === norm)) return err("This mobile number is already registered for the free week on another account. Each family can register once.");
          fw.members.push({ account_id: authedId, phone: norm, consent: !!body.p_marketing_consent });
          fw.enrolCalls = (fw.enrolCalls || 0) + 1;
          return send(204);
        }
        if (n === "free_week_doctors_list") {
          if (!live) return send(200, []);
          return send(200, fw.optedDoctors.map((d) => ({ doctor_id: d.doctor_id, daily_free_cap: d.cap, free_left_today: Math.max(d.cap - fw.claims.filter((c) => c.doctor_id === d.doctor_id && c.status !== "cancelled").length, 0), open_slots: fw.slots.filter((x) => x.doctor_id === d.doctor_id).length })));
        }
        if (n === "free_week_open_slots") {
          if (!fw || fw.phase !== "open") return send(200, []);
          return send(200, fw.slots.filter((x) => !state.consultations.some((c) => c.slot_id === x.id && c.status !== "cancelled")));
        }
        if (n === "free_week_claim") {
          if (!authedId) return err("Please log in to claim a free consultation.");
          if (!fw || fw.phase !== "open") return err("The free consultation week is not open right now.");
          if (isGuest) return err("Free consultations are for registered accounts. Please create a free account first.");
          if (!fw.members.some((m) => m.account_id === authedId)) return err("Please register for the free week first (your mobile number is needed).");
          if (!state.family_members.some((m) => m.id === body.p_patient_id && m.account_id === authedId)) return err("You can only book for people in your own account.");
          if (!fw.modes.includes(body.p_delivery_mode)) return err("Free consultations are available by text or audio call only.");
          const od = fw.optedDoctors.find((d) => d.doctor_id === body.p_doctor_id);
          if (!od) return err("This doctor is not offering free consultations right now.");
          if (used() >= fw.credits) return err("You have used all " + fw.credits + " free consultations for your account.");
          if (fw.claims.filter((c) => c.doctor_id === od.doctor_id && c.status !== "cancelled").length >= od.cap) return err("This doctor has given all their free consultations for that day. Please choose another day or doctor.");
          if (body.p_delivery_mode === "audio") {
            const sl = fw.slots.find((x) => x.id === body.p_slot_id && x.doctor_id === od.doctor_id);
            if (!sl) return err("That time is no longer available. Please choose another.");
            if (state.consultations.some((c) => c.slot_id === sl.id && c.status !== "cancelled")) return err("Selected time slot is already full.");
          }
          const row = { id: uuid(), status: "submitted", created_at: iso(Date.now()), patient_id: body.p_patient_id, doctor_id: body.p_doctor_id, complaint: body.p_complaint, delivery_mode: body.p_delivery_mode, slot_id: body.p_delivery_mode === "audio" ? body.p_slot_id : null };
          state.consultations.push(row);
          fw.claims.push({ account_id: authedId, doctor_id: body.p_doctor_id, consultation_id: row.id, status: "submitted" });
          return send(200, row.id);
        }
        if (n === "free_week_my_state") {
          if (!fw || !state.doctorIds.includes(authedId) || fw.phase === "none" || fw.phase === "ended") return send(200, { phase: "none" });
          return send(200, { phase: fw.phase, name: fw.name, starts_on: fw.starts_on, ends_on: fw.ends_on, modes: fw.modes, opted_in: fw.docOpt.opted_in, daily_free_cap: fw.docOpt.cap, free_visits_total: fw.claims.length });
        }
        if (n === "free_week_set_optin") {
          fw.optCalls.push(body);
          if (body.p_opt_in && !body.p_accept_terms) return err("Please confirm the free week terms to take part.");
          fw.docOpt = { opted_in: !!body.p_opt_in, cap: body.p_daily_cap || 5 };
          return send(204);
        }
        if (n === "free_week_add_slots") { fw.addCalls.push(body); fw.slots.push({ id: "fs" + (fw.slots.length + 1), doctor_id: authedId, start_time: iso(Date.now() + 2 * DAY) }); return send(200, { created: 4, skipped: 0 }); }
        if (n === "free_week_my_slots") return send(200, fw.slots.map((x) => ({ id: x.id, start_time: x.start_time, booked: state.consultations.some((c) => c.slot_id === x.id) })));
        if (n === "free_week_remove_slot") { fw.slots = fw.slots.filter((x) => x.id !== body.p_slot_id); return send(204); }
        if (n.startsWith("admin_free_week_")) {
          if (!(state.adminIds || []).includes(authedId)) return err("Admins only.");
          if (n === "admin_free_week_get") return send(200, fw ? { exists: true, phase: fw.phase, name: fw.name, opens_on: fw.opens_on, starts_on: fw.starts_on, ends_on: fw.ends_on, active: fw.phase !== "none", credits_per_account: fw.credits, overall_cap: null } : { exists: false });
          if (n === "admin_free_week_save") { state.fwSaved = body; return send(200, uuid()); }
          if (n === "admin_free_week_report") return send(200, { exists: true, phase: fw.phase, families_registered: fw.members.length, families_consenting: fw.members.filter((m) => m.consent).length, families_booked: new Set(fw.claims.map((c) => c.account_id)).size, visits_booked: fw.claims.length, visits_completed: 0, visits_cancelled: 0, visits_text: fw.claims.length, visits_audio: 0, doctors_opted_in: fw.optedDoctors.length, families_completed_free: 0, families_paid_after: 0, paid_revenue_pkr: 0, doctors: [{ doctor_id: DOC, full_name: "Dr Test Doctor", opted_in: true, daily_free_cap: 5, visits: fw.claims.length, completed: 0, free_slots: fw.slots.length, avg_rating: null, review_count: null }] });
          if (n === "admin_free_week_families") return send(200, fw.members.map((m) => ({ full_name: "Family " + m.phone.slice(-4), email: "f@x.com", mobile: m.phone, marketing_consent: m.consent, registered_at: iso(Date.now()), free_visits: 0, completed: 0 })));
        }
        return send(200, []);
      }
      if (n === "list_open_slots") return state.slotsFail ? send(400, { message: "permission denied for function list_open_slots" }) : send(200, slotsOut());
      if (n === "consultation_patient_phone") {
        const c = state.consultations.find((x) => x.id === body.p_consultation_id);
        if (!c || c.doctor_id !== authedId) return send(200, null);
        const fm = state.family_members.find((m) => m.id === c.patient_id);
        const u = fm && state.users.find((x) => x.id === fm.account_id);
        return send(200, (u && u.user_metadata.phone) || null);
      }
      if (n === "admin_feedback_rows") {
        if (!(state.adminIds || []).includes(authedId)) return send(403, { message: "not admin" });
        return send(200, state.feedback.map((f) => ({ feedback_id: f.id, kind: f.kind, rating: f.rating, message: f.message, status: f.status || "open", consultation_id: f.consultation_id, created_at: f.created_at, submitter_name: "Secret Name", submitter_phone: "0300", featured_for_marketing: false })));
      }
      if (n === "text_availability_status") return send(200, [state.textStatus]);
      if (n === "doctor_daily_capacity") return send(200, [state.capacity]);
      if (n === "guest_last_appointment_end") return send(200, lastEnd(body.p_account_id));
      if (n === "access_throttle_hit") { const r = bump(body.p_key, body.p_window_secs); return send(200, r.fail_count <= body.p_max); }
      if (n === "access_throttle_locked") { const r = thr(body.p_key); return send(200, r && r.locked_until && r.locked_until > Date.now() ? Math.ceil((r.locked_until - Date.now()) / 1000) : 0); }
      if (n === "access_throttle_fail") { const r = bump(body.p_key, body.p_window_secs); if (r.fail_count >= body.p_max) r.locked_until = Date.now() + body.p_lock_secs * 1000; return send(204); }
      if (n === "access_throttle_clear") { state.access_throttle = state.access_throttle.filter((x) => x.key !== body.p_key); return send(204); }
      return send(200, []);
    }

    // ---- storage (sponsored-ads bucket): uploads recorded, any public path serves a fixture flyer
    const stm = p.match(/^\/storage\/v1\/object\/(public\/)?sponsored-ads(\/(.*))?$/);
    if (stm) {
      if (stm[1] && method === "GET") {
        const fs = require("fs"); const nm = (stm[3] || "").includes("wide") ? "flyer_wide.png" : "flyer.png";
        res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); return res.end(fs.readFileSync(require("path").join(__dirname, nm)));
      }
      if (!stm[1] && method === "POST") { state.uploads.push({ path: stm[3], bytes: raw.length }); return send(200, { Key: "sponsored-ads/" + stm[3] }); }
      if (!stm[1] && method === "DELETE") { state.removed.push(...((body && body.prefixes) || [])); return send(200, []); }
    }

    // ---- tables
    const tm = p.match(/^\/rest\/v1\/([^/]+)$/);
    if (tm) {
      const t = tm[1];
      const f = filtersOf(url);
      if (t === "public_doctor_directory" && method === "GET") {
        const rows = state.directory.filter((r) => f.every((x) => ok(r, x)));
        return obj ? ONE(rows[0]) : send(200, rows);
      }
      if (t === "family_members") {
        if (method === "GET") {
          let rows = state.family_members.filter((r) => f.every((x) => ok(r, x)));
          if (!isService) rows = authedId ? rows.filter((r) => r.account_id === authedId) : [];
          const lim = url.searchParams.get("limit"); if (lim) rows = rows.slice(0, Number(lim));
          return obj ? ONE(rows[0]) : send(200, rows);
        }
        if (method === "PATCH") { state.family_members.filter((r) => f.every((x) => ok(r, x))).forEach((r) => Object.assign(r, body)); return send(204); }
      }
      if (t === "guest_access") {
        if (method === "POST") { state.guest_access.push({ created_at: iso(Date.now()), pin_hash: null, ...body }); return send(201); }
        if (method === "PATCH") { state.guest_access.filter((r) => f.every((x) => ok(r, x))).forEach((r) => Object.assign(r, body)); return send(204); }
        if (method === "GET") {
          let rows = state.guest_access.filter((r) => f.every((x) => ok(r, x)));
          rows = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          const lim = url.searchParams.get("limit"); if (lim) rows = rows.slice(0, Number(lim));
          return send(200, rows);
        }
      }
      if (t === "consultation_messages") {
        if (method === "GET") {
          if (state.noReplyCol && (url.searchParams.get("select") || "").includes("reply_to_id")) return send(400, { code: "42703", message: "column consultation_messages.reply_to_id does not exist" });
          const cid = (url.searchParams.get("consultation_id") || "").replace("eq.", "");
          const rows = state.messages.filter((m) => m.consultation_id === cid).map((m) => { const r = { ...m }; if (state.noReplyCol) delete r.reply_to_id; return r; });
          return send(200, rows);
        }
        if (method === "POST") {
          const orig = body.reply_to_id ? state.messages.find((m) => m.id === body.reply_to_id) : null;
          if (body.reply_to_id && (!orig || orig.consultation_id !== body.consultation_id)) return send(400, { message: "You can only reply to a message in the same conversation." });
          const row = { id: uuid(), created_at: iso(Date.now() + state.messages.length), attachment_path: null, attachment_filename: null, reply_to_id: null, ...body };
          state.messages.push(row);
          return send(201);
        }
      }
      if (t === "active_sponsored_ads" && method === "GET") return send(200, state.ads || []);
      if (t === "active_site_popups" && method === "GET") {
        if (state.popupsMissing) return send(404, { code: "42P01", message: "relation \"public.active_site_popups\" does not exist" });
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
        let rows = state.popups.filter((r) => r.status === "active" && r.starts_at <= today && today <= r.ends_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const lim = url.searchParams.get("limit"); if (lim) rows = rows.slice(0, Number(lim));
        return send(200, rows.map((r) => ({ id: r.id, image_url: r.image_url, click_url: r.click_url, button_label: r.button_label, created_at: r.created_at })));
      }
      if (t === "site_popups") {
        if (state.popupsMissing) return send(404, { code: "42P01", message: "relation \"public.site_popups\" does not exist" });
        const isAdmin = (state.adminIds || []).includes(authedId);
        if (method === "GET") { if (!isAdmin && !isService) return obj ? ONE(null) : send(200, []); const idq = (url.searchParams.get("id") || "").replace("eq.", ""); let rows = state.popups.slice().sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at))); if (idq) rows = rows.filter((r) => r.id === idq); return obj ? ONE(rows[0]) : send(200, rows); }
        if (method === "POST") {
          if (!isService && !isAdmin) return send(403, { message: "new row violates row-level security policy" });
          if (body.ends_at < body.starts_at) return send(400, { message: "violates check constraint" });
          const row = { id: uuid(), status: "active", created_at: iso(Date.now() + state.popups.length), button_label: "Register free", ...body };
          state.popups.push(row); return send(201);
        }
        if (method === "PATCH") {
          if (!isAdmin) return send(200, []);
          const idEq = (url.searchParams.get("id") || "").replace("eq.", "");
          state.popups.filter((r) => r.id === idEq).forEach((r) => Object.assign(r, body)); return send(204);
        }
        if (method === "DELETE") {
          if (!isService && !isAdmin) return send(200, []);
          const idEq = (url.searchParams.get("id") || "").replace("eq.", "");
          state.popups = state.popups.filter((r) => r.id !== idEq); return send(204);
        }
      }
      if (t === "admin_profiles" && method === "GET") {
        const row = (state.adminIds || []).includes(authedId) ? { id: authedId, full_name: "Admin One", created_at: "2026-01-01T00:00:00Z" } : null;
        return obj ? ONE(row) : send(200, row ? [row] : []);
      }
      if (t === "family_members" && method === "POST") {
        if (!authedId || body.account_id !== authedId) return send(403, { message: "new row violates row-level security policy" });
        const row = { id: uuid(), archived_at: null, created_at: iso(Date.now()), ...body };
        state.family_members.push(row);
        return obj ? send(201, row) : send(201, [row]);
      }
      if (t === "patient_feedback") {
        if (method === "POST") {
          // Emulates the 0080 trigger.
          if (!authedId || body.account_id !== authedId) return send(403, { message: "new row violates row-level security policy for table \"patient_feedback\"" });
          const row = { id: uuid(), created_at: iso(Date.now() + state.feedback.length), comment_status: "none", rating_hidden: false, doctor_id: null, ...body };
          row.rating_hidden = false; row.comment_status = "none";
          if (row.kind === "review" && row.consultation_id) {
            const c = state.consultations.find((x) => x.id === row.consultation_id);
            const fm = c && state.family_members.find((m) => m.id === c.patient_id);
            if (!c || !fm || fm.account_id !== authedId) return send(400, { message: "You can only review your own consultation." });
            if (c.status !== "completed") return send(400, { message: "You can review a consultation once it is completed." });
            if (state.feedback.some((f) => f.kind === "review" && f.consultation_id === row.consultation_id)) return send(400, { message: "You have already reviewed this consultation." });
            row.doctor_id = c.doctor_id;
            if (row.rating == null) return send(400, { message: "Please choose a star rating." });
            if (row.message && row.message.trim()) row.comment_status = "pending";
          }
          state.feedback.push(row);
          return send(201);
        }
        if (method === "GET") return send(200, state.feedback.map((f) => ({ id: f.id, comment_status: f.comment_status, rating_hidden: f.rating_hidden })));
        if (method === "PATCH") {
          const idEq = (url.searchParams.get("id") || "").replace("eq.", "");
          state.feedback.filter((f) => f.id === idEq).forEach((f) => Object.assign(f, body));
          return send(204);
        }
      }
      if (t === "doctor_rating_summary" && method === "GET") {
        if (state.noRatings) return send(404, { code: "42P01", message: "relation \"public.doctor_rating_summary\" does not exist" });
        const by = {};
        for (const f of state.feedback) {
          if (f.kind !== "review" || f.rating_hidden || !f.consultation_id) continue;
          const c = state.consultations.find((x) => x.id === f.consultation_id);
          if (!c || c.status !== "completed") continue;
          (by[c.doctor_id] = by[c.doctor_id] || []).push(f.rating);
        }
        return send(200, Object.entries(by).map(([doctor_id, rs]) => ({ doctor_id, avg_rating: (Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10).toFixed(1), review_count: rs.length })));
      }
      if (t === "public_doctor_reviews" && method === "GET") {
        if (state.noRatings) return send(404, { code: "42P01", message: "relation does not exist" });
        const did = (url.searchParams.get("doctor_id") || "").replace("eq.", "");
        const rows = state.feedback.filter((f) => f.kind === "review" && f.comment_status === "approved" && !f.rating_hidden && f.doctor_id === did).map((f) => ({ id: f.id, rating: f.rating, message: f.message, created_at: f.created_at }));
        return send(200, rows);
      }
      if (t === "consultations") {
        if (method === "POST") {
          const mine = state.family_members.find((m) => m.id === body.patient_id && m.account_id === authedId);
          if (!mine) return send(403, { message: "new row violates row-level security policy for table \"consultations\"" });
          if (body.slot_id) {
            const slot = state.slots.find((s) => s.id === body.slot_id);
            const taken = state.consultations.filter((c) => c.slot_id === body.slot_id && c.status !== "cancelled").length;
            if (!slot || taken >= slot.capacity) return send(400, { message: "Selected time slot is already full." });
          }
          const row = { id: uuid(), status: "pending_payment", created_at: iso(Date.now()), slot_id: null, ...body };
          state.consultations.push(row);
          return obj ? send(201, { id: row.id }) : send(201, [{ id: row.id }]);
        }
        if (method === "GET") {
          const inner = f.find((x) => x.col === "patient.account_id");
          let rows = state.consultations.filter((r) => f.filter((x) => x.col !== "patient.account_id").every((x) => ok(r, x)));
          if (!isService) rows = authedId ? rows.filter((r) => state.doctorIds.includes(authedId) ? r.doctor_id === authedId : state.family_members.some((m) => m.id === r.patient_id && m.account_id === authedId)) : [];
          if (inner) rows = rows.filter((r) => state.family_members.some((m) => m.id === r.patient_id && m.account_id === inner.val));
          rows = rows.map((r) => ({ ...r, patient: (() => { const m = state.family_members.find((x) => x.id === r.patient_id) || {}; return { account_id: m.account_id, full_name: m.full_name, relationship: m.relationship, date_of_birth: null }; })(), scheduled_slot: state.slots.find((s) => s.id === r.slot_id) || null }));
          return obj ? ONE(rows[0]) : send(200, rows);
        }
      }
      if (t === "doctor_agreement_acceptances" && method === "GET") return obj ? ONE(state.doctorIds.includes(authedId) ? { id: "agr1" } : null) : send(200, state.doctorIds.includes(authedId) ? [{ id: "agr1" }] : []);
      if (t === "doctor_profiles" && method === "PATCH" && (isService || state.doctorIds.includes(authedId))) {
        state.docPhones = state.docPhones || {};
        const idEq = (url.searchParams.get("id") || "").replace("eq.", "");
        if (!idEq || !state.doctorIds.includes(idEq)) return send(200, []);
        if (body && body.phone) state.docPhones[idEq] = body.phone;
        return send(200, [{ id: idEq }]);
      }
      if (t === "doctor_profiles" && method === "GET" && (url.searchParams.get("select") || "") === "id, phone") {
        const dp = state.docPhones || {};
        return send(200, state.doctorIds.map((id) => ({ id, phone: dp[id] || null })));
      }
      if (t === "doctor_profiles" && method === "GET" && state.doctorIds.includes(authedId)) {
        const row = { id: authedId, phone: (state.docPhones || {})[authedId] || null, full_name: "Dr Test Doctor", email: "d@x.com", specialty: "Family Medicine", is_active: true, verification_status: "approved", subscription_status: "active", subscription_current_period_end: iso(Date.now() + 20 * DAY), use_safepay_checkout: true, consultation_fee: 800, fee_status: "approved", created_at: "2026-01-01T00:00:00Z", rejection_reason: null, custom_platform_share: null, daily_patient_cap: 100, safepay_subscription_id: null, subscription_last_event_at: null };
        return obj ? ONE(row) : send(200, [row]);
      }
      // anything else (doctor/admin profile lookups etc.): nothing found
      if (method === "GET") return obj ? ONE(null) : send(200, []);
      return send(204);
    }
    return send(404, { message: "unhandled " + method + " " + p });
  });
});
server.listen(PORT, () => console.log("fake supabase on", PORT));
