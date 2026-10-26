"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { fmtDate, isMissingFunction, modesText, pkr } from "@/lib/packages";

// Doctor side of Family Packs (migrations 0088-0091).
//   * ask Family Medic for a pack (the admin approves or adjusts it)
//   * see the families on your pack, who is waiting for a reply, and what is owed
//   * pause new sales, share your referral link, list your own patients' mobile numbers
// A family's text chat, calls and prescriptions are the normal consultation
// screens; this page only organises the families.

interface PackageRow {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  price_pkr: number;
  members_allowed: number;
  consultations_total: number;
  allow_text: boolean;
  allow_audio: boolean;
  allow_video: boolean;
  audio_limit: number | null;
  video_limit: number | null;
  validity_days: number;
  rollover_enabled: boolean;
  rollover_cap: number;
  rollover_window_days: number;
  reply_window_hours: number;
  max_families: number | null;
  doctor_share_own_pct: number;
  doctor_share_platform_pct: number;
}
interface RequestRow {
  id: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  name: string;
  price_pkr: number;
  members_allowed: number;
  consultations_total: number;
  allow_audio: boolean;
  allow_video: boolean;
  created_at: string;
  admin_note: string | null;
}
interface Thread {
  consultation_id: string;
  member: string;
  mode: string;
  status: string;
  created_at: string;
  needs_reply: boolean;
}
interface Family {
  purchase_id: string;
  family_name: string;
  members: string[];
  credits_left: number;
  credits_total: number;
  expires_at: string;
  source: "doctor" | "platform";
  doctor_share_pkr: number | null;
  needs_reply: number;
  overdue: number;
  threads: Thread[];
}
interface State {
  sales_open: boolean;
  package: PackageRow | null;
  request: RequestRow | null;
  active_families: number;
  families: Family[];
  needs_reply: number;
  overdue: number;
  used_this_month: number;
  earned_pkr: number;
  paid_out_pkr: number;
  owed_pkr: number;
  ref_code: string | null;
  invite_count: number;
}
interface Invite {
  id: string;
  phone_norm: string;
  created_at: string;
}

const CARD = "rounded-[26px] bg-white p-5 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-6";
const BTN =
  "rounded-full bg-teal-700 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-[#b9d3cd]";
const BTN2 =
  "rounded-full border border-teal-600 px-4 py-2 text-sm font-extrabold text-teal-800 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "mt-1 block w-full rounded-md border border-[#d7e7e2] px-3 py-2 text-sm";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl bg-[#f5faf8] p-4">
      <div className="text-xl font-extrabold text-ink-900">{value}</div>
      <div className="text-xs font-semibold text-ink-700">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

export default function DoctorPackagePage() {
  const { profile, profileChecking, authLoading, signOut } = useDoctorProfileWithSignOut();
  const [st, setSt] = useState<State | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // request form
  const [name, setName] = useState("Family Pack");
  const [price, setPrice] = useState("1800");
  const [members, setMembers] = useState("3");
  const [total, setTotal] = useState("8");
  const [audio, setAudio] = useState(false);
  const [video, setVideo] = useState(false);
  const [audioLimit, setAudioLimit] = useState("");
  const [videoLimit, setVideoLimit] = useState("");
  const [rollover, setRollover] = useState(true);
  const [maxFam, setMaxFam] = useState("20");
  const [note, setNote] = useState("");
  const [numbers, setNumbers] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("doctor_package_my_state");
    if (error) {
      if (isMissingFunction(error.message)) setUnavailable(true);
      else setMsg({ ok: false, text: error.message });
      return;
    }
    setSt(data as State);
    const inv = await supabase.rpc("doctor_package_invite_list");
    setInvites(inv.error ? [] : ((inv.data ?? []) as Invite[]));
  }, []);

  const doctorId = profile?.id;
  useEffect(() => {
    if (!doctorId) return;
    Promise.resolve().then(load);
  }, [doctorId, load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, okText: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else {
      setMsg({ ok: true, text: okText });
      await load();
    }
  }

  function sendRequest() {
    if (!supabase) return;
    void run(
      () =>
        supabase!.rpc("doctor_package_request", {
          p_data: {
            name,
            price_pkr: price,
            members_allowed: members,
            consultations_total: total,
            allow_text: true,
            allow_audio: audio,
            allow_video: video,
            audio_limit: audio ? audioLimit : "",
            video_limit: video ? videoLimit : "",
            rollover_allowed: rollover,
            max_families: maxFam,
            note,
          },
        }),
      "Your request has been sent. Family Medic will review it and let you know."
    );
  }

  async function copyLink() {
    if (!st || !doctorId || !supabase) return;
    // The personal code is created the first time it is asked for.
    let code = st.ref_code;
    if (!code) {
      const { data, error } = await supabase.rpc("doctor_package_ref_code");
      if (error || typeof data !== "string" || !data) {
        setMsg({ ok: false, text: error?.message ?? "Couldn't make your link. Please try again." });
        return;
      }
      code = data;
      setSt({ ...st, ref_code: code });
    }
    const url = `https://thefamilymedic.com/doctors/${doctorId}?pack=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ ok: false, text: url });
    }
  }

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell active="package">
        <p className="text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking || (!st && !unavailable)) {
    return (
      <DoctorShell active="package">
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell active="package">
        <p className="text-sm text-ink-700">
          Please <Link href="/doctor/login" className="font-semibold text-teal-700 underline">log in</Link> with your doctor account.
        </p>
      </DoctorShell>
    );
  }
  if (unavailable || !st) {
    return (
      <DoctorShell active="package" doctorName={profile.full_name} onSignOut={signOut} doctorId={profile.id}>
        <p className="text-sm text-ink-500">Family packs are not switched on yet.</p>
      </DoctorShell>
    );
  }

  const pk = st.package;
  const rq = st.request;
  const req = rq?.status === "pending" ? rq : null;
  const lastDecided = rq && rq.status !== "pending" ? rq : null;

  return (
    <DoctorShell active="package" doctorName={profile.full_name} onSignOut={signOut} doctorId={profile.id}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Family Pack</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-500">
        A family pays once for a set number of consultations with you. They message you whenever they need to, and you reply in your working hours.
        Prescriptions and ending a consultation work exactly as they do today.
      </p>

      {msg && (
        <div role="status" className={`mt-4 rounded-2xl border p-3 text-sm ${msg.ok ? "border-teal-200 bg-teal-50 text-teal-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          {msg.text}
        </div>
      )}

      {!pk && (
        <div className="mt-6 space-y-5">
          {lastDecided && (
            <div className={`${CARD} text-sm`}>
              <p className="font-extrabold text-ink-900">
                Your last request was {lastDecided.status === "approved" ? "approved" : lastDecided.status === "declined" ? "not approved this time" : "withdrawn"}.
              </p>
              {lastDecided.admin_note && <p className="mt-1 text-ink-700">Note from Family Medic: {lastDecided.admin_note}</p>}
            </div>
          )}

          {req ? (
            <div className={CARD}>
              <h2 className="text-base font-extrabold text-ink-900">Request sent {fmtDate(req.created_at)}</h2>
              <p className="mt-2 text-sm text-ink-700">
                {req.name}: {pkr(req.price_pkr)} for {req.consultations_total} consultations, up to {req.members_allowed} people in a family. Family Medic will review it
                and may adjust the details with you.
              </p>
              <button type="button" disabled={busy} onClick={() => run(() => supabase!.rpc("doctor_package_withdraw_request"), "Request withdrawn.")} className={`${BTN2} mt-4`}>
                Withdraw this request
              </button>
            </div>
          ) : (
            <div className={CARD}>
              <h2 className="text-base font-extrabold text-ink-900">Ask for a Family Pack</h2>
              <p className="mt-1 text-xs text-ink-500">Tell us what you would like to offer. Family Medic reviews every request and sets the final details with you.</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-ink-700">
                  Pack name
                  <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  Price you propose (PKR)
                  <input type="number" min={100} value={price} onChange={(e) => setPrice(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  People in one family (1 to 8)
                  <input type="number" min={1} max={8} value={members} onChange={(e) => setMembers(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  Consultations in the pack
                  <input type="number" min={1} max={60} value={total} onChange={(e) => setTotal(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-xs font-semibold text-ink-700">
                  Most families you can take
                  <input type="number" min={1} value={maxFam} onChange={(e) => setMaxFam(e.target.value)} className={FIELD} />
                </label>
              </div>
              <div className="mt-4 text-xs font-semibold text-ink-700">How you will answer</div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-900">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked disabled className="h-4 w-4 rounded border-[#d7e7e2] text-teal-700" /> Text and voice notes
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} className="h-4 w-4 rounded border-[#d7e7e2] text-teal-700" /> Audio calls
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} className="h-4 w-4 rounded border-[#d7e7e2] text-teal-700" /> Video calls
                </label>
              </div>
              {(audio || video) && (
                <div className="mt-3 grid grid-cols-2 gap-4 sm:max-w-md">
                  {audio && (
                    <label className="block text-xs font-semibold text-ink-700">
                      Audio calls at most (optional)
                      <input type="number" min={1} value={audioLimit} onChange={(e) => setAudioLimit(e.target.value)} className={FIELD} />
                    </label>
                  )}
                  {video && (
                    <label className="block text-xs font-semibold text-ink-700">
                      Video calls at most (optional)
                      <input type="number" min={1} value={videoLimit} onChange={(e) => setVideoLimit(e.target.value)} className={FIELD} />
                    </label>
                  )}
                </div>
              )}
              <label className="mt-4 flex items-start gap-2.5 text-sm text-ink-700">
                <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#d7e7e2] text-teal-700" />
                <span>I would allow unused consultations to carry over when a family renews within a week (up to half the pack).</span>
              </label>
              <label className="mt-4 block text-xs font-semibold text-ink-700">
                Note to Family Medic (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={600} className={FIELD} />
              </label>
              <button type="button" disabled={busy} onClick={sendRequest} className={`${BTN} mt-5`}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          )}
        </div>
      )}

      {pk && (
        <div className="mt-6 space-y-5">
          {!st.sales_open && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Your pack is approved but is not on sale to the public yet. Family Medic will switch sales on when the pilot starts. Families you add by hand are not affected.
            </div>
          )}
          {st.overdue > 0 && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {st.overdue} message{st.overdue === 1 ? " is" : "s are"} past the {pk.reply_window_hours}-hour reply time. Please reply as soon as you can.
            </div>
          )}

          <div className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-ink-900">{pk.name}</h2>
                <p className="text-sm text-ink-500">
                  {pkr(pk.price_pkr)} &middot; {pk.consultations_total} consultations &middot; up to {pk.members_allowed} people &middot; {pk.validity_days} days
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {modesText(pk)}.{" "}
                  {pk.rollover_enabled
                    ? `Unused consultations carry over if the family renews within ${pk.rollover_window_days} days (up to ${pk.rollover_cap}).`
                    : "Unused consultations do not carry over."}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${pk.status === "active" ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>
                {pk.status === "active" ? "Taking new families" : "Paused for new families"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => supabase!.rpc("doctor_package_set_paused", { p_paused: pk.status === "active" }), pk.status === "active" ? "New sales paused. Your current families are not affected." : "New sales resumed.")}
                className={BTN2}
              >
                {pk.status === "active" ? "Pause new sales" : "Resume new sales"}
              </button>
              {pk.status === "active" && (
                <Link href="/doctor/package/flyer" className={BTN2}>
                  Make my pack flyer
                </Link>
              )}
              <span className="text-xs text-ink-500">
                {st.active_families} of {pk.max_families ?? "any number of"} families on your pack. Pausing never affects families who already have it.
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Your share: {pk.doctor_share_own_pct}% of the pack price for families you bring (your link or your invite list) and {pk.doctor_share_platform_pct}% for families Family Medic brings. Paid by
              Family Medic after each sale.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Waiting for your reply" value={st.needs_reply} hint={`Reply within ${pk.reply_window_hours} hours`} />
            <Stat label="Pack consultations this month" value={st.used_this_month} />
            <Stat label="Your earnings from packs" value={pkr(st.earned_pkr)} hint={`Paid so far ${pkr(st.paid_out_pkr)}`} />
            <Stat label={st.owed_pkr < 0 ? "To be deducted next time" : "Owed to you"} value={pkr(Math.abs(st.owed_pkr))} />
          </div>

          <div className={CARD}>
            <h2 className="text-base font-extrabold text-ink-900">Families on your pack</h2>
            {st.families.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">No family yet. Share your link below or add your own patients&rsquo; numbers to the invite list.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {st.families.map((f) => (
                  <li key={f.purchase_id} className="rounded-2xl border border-[#e6efec] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-extrabold text-ink-900">{f.family_name}&rsquo;s family</div>
                        <div className="text-xs text-ink-500">
                          {f.members.length > 0 ? f.members.join(", ") : "No one has used it yet"} &middot; ends {fmtDate(f.expires_at)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-[#eef6f3] px-2.5 py-1 text-teal-900">
                          {f.credits_left} of {f.credits_total} left
                        </span>
                        <span className="rounded-full bg-[#f4f4f1] px-2.5 py-1 text-ink-700">{f.source === "doctor" ? "Your family" : "Family Medic family"}</span>
                        {f.needs_reply > 0 && (
                          <span className={`rounded-full px-2.5 py-1 ${f.overdue > 0 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                            {f.overdue > 0 ? "Overdue" : "Waiting for you"}
                          </span>
                        )}
                      </div>
                    </div>
                    {f.threads.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {f.threads.map((t) => (
                          <li key={t.consultation_id}>
                            <Link
                              href={`/doctor/consultations/${t.consultation_id}`}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${t.needs_reply ? "bg-amber-100 text-amber-900" : "bg-[#eef6f3] text-teal-900"}`}
                            >
                              {t.member} &middot; {t.mode} &middot; {fmtDate(t.created_at)}
                              {t.needs_reply ? " · reply" : ""}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={CARD}>
            <h2 className="text-base font-extrabold text-ink-900">Bring your own patients</h2>
            <p className="mt-1 text-xs text-ink-500">
              A family counts as yours (your higher share) when its mobile number is on your invite list or when it first reached Family Medic through your link. Numbers are only used to match
              them when they buy; the patients are not contacted.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={copyLink} className={BTN2}>
                {copied ? "Copied" : "Copy my pack link"}
              </button>
              <span className="text-xs text-ink-500">Share it on WhatsApp or print it on your card. It opens your page and remembers you brought them.</span>
            </div>
            <label className="mt-4 block text-xs font-semibold text-ink-700">
              Add mobile numbers (one per line or separated by commas)
              <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={3} placeholder="0300 1234567" className={FIELD} />
            </label>
            <button
              type="button"
              disabled={busy || !numbers.trim()}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                const { data, error } = await supabase!.rpc("doctor_package_invite_add", { p_numbers: numbers });
                setBusy(false);
                if (error) setMsg({ ok: false, text: error.message });
                else {
                  const r = data as { added?: number; invalid?: string[] };
                  setMsg({ ok: true, text: `${r.added ?? 0} number${r.added === 1 ? "" : "s"} added${r.invalid && r.invalid.length ? `. Not understood: ${r.invalid.join(", ")}` : ""}.` });
                  setNumbers("");
                  await load();
                }
              }}
              className={`${BTN} mt-3`}
            >
              Add to my list
            </button>
            {invites.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-teal-700">Your list ({invites.length})</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {invites.map((i) => (
                    <span key={i.id} className="inline-flex items-center gap-1.5 rounded-lg bg-[#eef6f3] px-2.5 py-1 text-xs font-bold text-teal-900">
                      0{i.phone_norm.replace(/^92/, "")}
                      <button
                        type="button"
                        aria-label="Remove this number"
                        onClick={() => run(() => supabase!.rpc("doctor_package_invite_remove", { p_id: i.id }), "Removed.")}
                        className="text-ink-500 hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DoctorShell>
  );
}
