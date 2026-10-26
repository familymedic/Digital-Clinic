"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import AdminGuard from "@/components/AdminGuard";
import { supabase } from "@/lib/supabaseClient";
import { fmtDate, isMissingFunction, modesText, pkr } from "@/lib/packages";

// Admin screen for Family Packs (migrations 0088-0091).
//   Packs     - the master "sales open" switch, create/edit a pack for a doctor
//   Requests  - doctors asking for a pack: approve (optionally change terms) or decline
//   Families  - recent purchases, give a pack by hand, change who brought a family,
//               record a refund, return a credit, and text threads past their reply time
//   Payouts   - what each doctor is owed and a "mark paid" button
// Nothing here is public until the sales switch is turned on.

interface Doctor {
  id: string;
  full_name: string;
  specialty: string | null;
}
interface Pack {
  id: string;
  doctor_id: string;
  doctor_name: string;
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
  active_families: number;
}
interface Req {
  id: string;
  doctor_id: string;
  doctor_name: string;
  doctor_specialty: string | null;
  status: "pending" | "approved" | "declined" | "withdrawn";
  name: string;
  price_pkr: number;
  members_allowed: number;
  consultations_total: number;
  allow_text: boolean;
  allow_audio: boolean;
  allow_video: boolean;
  audio_limit: number | null;
  video_limit: number | null;
  rollover_allowed: boolean;
  max_families: number | null;
  note: string | null;
  created_at: string;
}
interface Overview {
  sales_open: boolean;
  doctors: Doctor[];
  packages: Pack[];
  requests: Req[];
}
interface Purchase {
  id: string;
  created_at: string;
  status: string;
  payment_method: string;
  price_pkr: number;
  expires_at: string | null;
  source: "doctor" | "platform";
  source_reason: string | null;
  doctor_share_pct: number;
  doctor_share_pkr: number | null;
  platform_share_pkr: number | null;
  doctor_paid_at: string | null;
  doctor_name: string;
  family_name: string;
  email: string | null;
  credits_left: number;
  credits_total: number;
}
interface Overdue {
  consultation_id: string;
  claim_id: string;
  doctor_name: string;
  member_name: string;
  reply_window_hours: number;
  waiting_since: string;
}
interface Activity {
  purchases: Purchase[];
  overdue: Overdue[];
}
interface PayLine {
  id: string;
  created_at: string;
  status: string;
  payment_method: string;
  price_pkr: number;
  refund_pkr: number | null;
  source: string;
  share_pct: number;
  share_pkr: number;
  paid_pkr: number;
  owed_pkr: number;
  family: string;
  email: string | null;
}
interface DoctorPay {
  doctor_id: string;
  doctor_name: string;
  earned_pkr: number;
  paid_pkr: number;
  owed_pkr: number;
  packs: number;
  lines: PayLine[];
}

const CARD = "rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]";
const BTN = "rounded-full bg-teal-700 px-5 py-2 text-sm font-extrabold text-white hover:bg-teal-800 disabled:bg-[#b9d3cd]";
const BTN2 = "rounded-full border border-teal-600 px-4 py-2 text-xs font-extrabold text-teal-800 hover:bg-teal-50 disabled:opacity-50";
const FIELD = "mt-1 block w-full rounded-md border border-[#d7e7e2] px-3 py-2 text-sm";
const STATUS_TEXT: Record<string, string> = { draft: "Draft", active: "On sale", paused: "Paused", archived: "Archived" };

interface FormState {
  id?: string;
  doctor_id: string;
  name: string;
  price_pkr: string;
  members_allowed: string;
  consultations_total: string;
  allow_audio: boolean;
  allow_video: boolean;
  audio_limit: string;
  video_limit: string;
  validity_days: string;
  rollover_enabled: boolean;
  rollover_cap: string;
  rollover_window_days: string;
  reply_window_hours: string;
  max_families: string;
  doctor_share_own_pct: string;
  doctor_share_platform_pct: string;
  status: string;
}

const EMPTY: FormState = {
  doctor_id: "",
  name: "Family Pack",
  price_pkr: "1800",
  members_allowed: "3",
  consultations_total: "8",
  allow_audio: false,
  allow_video: false,
  audio_limit: "",
  video_limit: "",
  validity_days: "30",
  rollover_enabled: true,
  rollover_cap: "4",
  rollover_window_days: "7",
  reply_window_hours: "24",
  max_families: "20",
  doctor_share_own_pct: "80",
  doctor_share_platform_pct: "70",
  status: "draft",
};

function fromPack(p: Pack): FormState {
  return {
    id: p.id,
    doctor_id: p.doctor_id,
    name: p.name,
    price_pkr: String(p.price_pkr),
    members_allowed: String(p.members_allowed),
    consultations_total: String(p.consultations_total),
    allow_audio: p.allow_audio,
    allow_video: p.allow_video,
    audio_limit: p.audio_limit == null ? "" : String(p.audio_limit),
    video_limit: p.video_limit == null ? "" : String(p.video_limit),
    validity_days: String(p.validity_days),
    rollover_enabled: p.rollover_enabled,
    rollover_cap: String(p.rollover_cap),
    rollover_window_days: String(p.rollover_window_days),
    reply_window_hours: String(p.reply_window_hours),
    max_families: p.max_families == null ? "" : String(p.max_families),
    doctor_share_own_pct: String(p.doctor_share_own_pct),
    doctor_share_platform_pct: String(p.doctor_share_platform_pct),
    status: p.status,
  };
}

function fromReq(r: Req): FormState {
  const total = r.consultations_total;
  return {
    ...EMPTY,
    doctor_id: r.doctor_id,
    name: r.name,
    price_pkr: String(r.price_pkr),
    members_allowed: String(r.members_allowed),
    consultations_total: String(total),
    allow_audio: r.allow_audio,
    allow_video: r.allow_video,
    audio_limit: r.audio_limit == null ? "" : String(r.audio_limit),
    video_limit: r.video_limit == null ? "" : String(r.video_limit),
    rollover_enabled: r.rollover_allowed,
    rollover_cap: String(Math.floor(total / 2)),
    max_families: r.max_families == null ? "" : String(r.max_families),
    status: "active",
  };
}

function PackForm({
  form,
  setForm,
  doctors,
  lockDoctor,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  doctors: Doctor[];
  lockDoctor?: boolean;
}) {
  const set = (k: keyof FormState, v: string | boolean) => setForm({ ...form, [k]: v } as FormState);
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
      <label className="col-span-2 block text-xs font-semibold text-ink-700 sm:col-span-3">
        Doctor
        <select value={form.doctor_id} disabled={lockDoctor || !!form.id} onChange={(e) => set("doctor_id", e.target.value)} className={FIELD}>
          <option value="">Choose a doctor…</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
              {d.specialty ? ` (${d.specialty})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2 block text-xs font-semibold text-ink-700 sm:col-span-1">Pack name<input value={form.name} onChange={(e) => set("name", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Price (PKR)<input type="number" value={form.price_pkr} onChange={(e) => set("price_pkr", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">People in a family<input type="number" value={form.members_allowed} onChange={(e) => set("members_allowed", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Consultations<input type="number" value={form.consultations_total} onChange={(e) => set("consultations_total", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Valid for (days)<input type="number" value={form.validity_days} onChange={(e) => set("validity_days", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Most families (blank = no limit)<input type="number" value={form.max_families} onChange={(e) => set("max_families", e.target.value)} className={FIELD} /></label>

      <div className="col-span-2 sm:col-span-3">
        <div className="text-xs font-semibold text-ink-700">How the doctor answers</div>
        <div className="mt-2 flex flex-wrap items-center gap-5 text-sm text-ink-900">
          <label className="flex items-center gap-2"><input type="checkbox" checked disabled className="h-4 w-4" /> Text and voice notes</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.allow_audio} onChange={(e) => set("allow_audio", e.target.checked)} className="h-4 w-4" /> Audio calls</label>
          {form.allow_audio && <input type="number" placeholder="at most" value={form.audio_limit} onChange={(e) => set("audio_limit", e.target.value)} className="w-24 rounded-md border border-[#d7e7e2] px-2 py-1 text-sm" />}
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.allow_video} onChange={(e) => set("allow_video", e.target.checked)} className="h-4 w-4" /> Video calls</label>
          {form.allow_video && <input type="number" placeholder="at most" value={form.video_limit} onChange={(e) => set("video_limit", e.target.value)} className="w-24 rounded-md border border-[#d7e7e2] px-2 py-1 text-sm" />}
        </div>
      </div>

      <div className="col-span-2 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <input type="checkbox" checked={form.rollover_enabled} onChange={(e) => set("rollover_enabled", e.target.checked)} className="h-4 w-4" />
          Unused consultations carry into a renewal
        </label>
        {form.rollover_enabled && (
          <div className="mt-2 grid grid-cols-2 gap-4 sm:max-w-md">
            <label className="block text-xs font-semibold text-ink-700">Carry at most<input type="number" value={form.rollover_cap} onChange={(e) => set("rollover_cap", e.target.value)} className={FIELD} /></label>
            <label className="block text-xs font-semibold text-ink-700">Renew within (days)<input type="number" value={form.rollover_window_days} onChange={(e) => set("rollover_window_days", e.target.value)} className={FIELD} /></label>
          </div>
        )}
      </div>

      <label className="block text-xs font-semibold text-ink-700">Reply time shown (hours)<input type="number" value={form.reply_window_hours} onChange={(e) => set("reply_window_hours", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Doctor share, doctor&rsquo;s family (%)<input type="number" value={form.doctor_share_own_pct} onChange={(e) => set("doctor_share_own_pct", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">Doctor share, our family (%)<input type="number" value={form.doctor_share_platform_pct} onChange={(e) => set("doctor_share_platform_pct", e.target.value)} className={FIELD} /></label>
      <label className="block text-xs font-semibold text-ink-700">
        Status
        <select value={form.status} onChange={(e) => set("status", e.target.value)} className={FIELD}>
          <option value="draft">Draft (not on sale)</option>
          <option value="active">On sale</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </label>
    </div>
  );
}

function Inner() {
  const [tab, setTab] = useState<"packs" | "requests" | "families" | "payouts">("packs");
  const [ov, setOv] = useState<Overview | null>(null);
  const [act, setAct] = useState<Activity | null>(null);
  const [pay, setPay] = useState<DoctorPay[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [approving, setApproving] = useState<{ req: Req; form: FormState; note: string } | null>(null);
  const [declining, setDeclining] = useState<{ id: string; note: string } | null>(null);
  const [grant, setGrant] = useState({ package_id: "", email: "", source: "platform", collected: false, note: "" });
  const [srcEdit, setSrcEdit] = useState<{ id: string; source: string; reason: string } | null>(null);
  const [refund, setRefund] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [markPaid, setMarkPaid] = useState<{ doctor: string; net: number; note: string } | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setErr(null);
    const o = await supabase.rpc("admin_package_overview");
    if (o.error) {
      setErr(isMissingFunction(o.error.message) ? "The family packs database update (migrations 0088 to 0091) has not been run yet." : o.error.message);
      return;
    }
    setOv(o.data as Overview);
    const a = await supabase.rpc("admin_package_activity");
    if (!a.error) setAct(a.data as Activity);
    const p = await supabase.rpc("admin_package_payouts");
    if (!p.error) setPay((p.data ?? []) as DoctorPay[]);
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, after?: () => void) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setMsg(ok);
      after?.();
      await load();
    }
  }

  const toData = (f: FormState) => ({ ...f, allow_text: true, id: f.id ?? "" });

  if (!ov) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {err ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div> : <p className="text-sm text-ink-500">Loading…</p>}
      </div>
    );
  }

  const pending = ov.requests.filter((r) => r.status === "pending");
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`rounded-full px-4 py-2 text-sm font-extrabold ${tab === k ? "bg-[#0a3733] text-white" : "border border-[#d7e7e2] bg-white text-ink-700"}`}
    >
      {label}
      {n ? ` (${n})` : ""}
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      {err && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div>}
      {msg && <div role="status" className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{msg}</div>}

      <div className={CARD}>
        <label className="flex items-center gap-2.5 text-sm font-bold text-ink-900">
          <input
            type="checkbox"
            checked={ov.sales_open}
            disabled={busy}
            onChange={(e) => run(() => supabase!.rpc("admin_package_set_sales", { p_open: e.target.checked }), e.target.checked ? "Sales are OPEN. Packs on sale now show on doctor pages." : "Sales are OFF. Nothing shows to the public.")}
            className="h-5 w-5 rounded border-[#d7e7e2] text-teal-700"
          />
          Sales open to the public (turn OFF to hide every pack at once)
        </label>
        <p className="mt-1 text-xs text-ink-500">
          While this is off, no pack appears on any doctor page and nobody can buy. Packs you give by hand below still work. Families who already hold a pack keep it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabBtn("packs", "Packs")}
        {tabBtn("requests", "Doctor requests", pending.length)}
        {tabBtn("families", "Families & activity", act?.overdue.length)}
        {tabBtn("payouts", "Doctor payouts")}
      </div>

      {tab === "packs" && (
        <>
          <div className={CARD}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-ink-900">{form ? (form.id ? "Edit pack" : "New pack") : "Packs"}</h2>
              {!form && <button type="button" className={BTN} onClick={() => setForm({ ...EMPTY })}>New pack for a doctor</button>}
            </div>
            {form && (
              <>
                <PackForm form={form} setForm={setForm} doctors={ov.doctors} />
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy || !form.doctor_id}
                    onClick={() => run(() => supabase!.rpc("admin_package_save", { p_data: toData(form) }), "Pack saved.", () => setForm(null))}
                    className={BTN}
                  >
                    {busy ? "Saving…" : "Save pack"}
                  </button>
                  <button type="button" className={BTN2} onClick={() => setForm(null)}>Cancel</button>
                </div>
                <p className="mt-2 text-xs text-ink-500">A doctor can have one live pack (on sale or paused) at a time. Changing price or terms affects new buyers only; families who already bought keep what they bought.</p>
              </>
            )}
          </div>

          <div className={CARD}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">Doctor</th><th>Pack</th><th>Price</th><th>Families</th><th>Shares</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {ov.packages.map((p) => (
                    <tr key={p.id} className="border-t border-[#e6efec] align-top">
                      <td className="py-2 font-semibold text-ink-900">{p.doctor_name}</td>
                      <td>
                        {p.name}
                        <div className="text-xs text-ink-500">{p.consultations_total} consultations, {p.members_allowed} people, {modesText(p)}</div>
                      </td>
                      <td>{pkr(p.price_pkr)}</td>
                      <td>{p.active_families}{p.max_families ? ` / ${p.max_families}` : ""}</td>
                      <td className="text-xs">{p.doctor_share_own_pct}% / {p.doctor_share_platform_pct}%</td>
                      <td><span className="rounded-full bg-[#eef6f3] px-2 py-0.5 text-xs font-bold text-teal-900">{STATUS_TEXT[p.status]}</span></td>
                      <td className="space-x-2 whitespace-nowrap text-right">
                        <button type="button" className={BTN2} onClick={() => setForm(fromPack(p))}>Edit</button>
                        {p.status === "active" && <button type="button" className={BTN2} disabled={busy} onClick={() => run(() => supabase!.rpc("admin_package_set_status", { p_id: p.id, p_status: "paused" }), "Paused.")}>Pause</button>}
                        {p.status === "paused" && <button type="button" className={BTN2} disabled={busy} onClick={() => run(() => supabase!.rpc("admin_package_set_status", { p_id: p.id, p_status: "active" }), "Back on sale.")}>Resume</button>}
                        {p.status === "draft" && <button type="button" className={BTN2} disabled={busy} onClick={() => run(() => supabase!.rpc("admin_package_set_status", { p_id: p.id, p_status: "active" }), "Put on sale. It shows on the doctor's page once sales are open.")}>Put on sale</button>}
                        {p.status !== "archived" && <button type="button" className={BTN2} disabled={busy} onClick={() => run(() => supabase!.rpc("admin_package_set_status", { p_id: p.id, p_status: "archived" }), "Archived.")}>Archive</button>}
                      </td>
                    </tr>
                  ))}
                  {ov.packages.length === 0 && <tr><td colSpan={7} className="py-3 text-ink-500">No packs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "requests" && (
        <div className={CARD}>
          <h2 className="text-lg font-extrabold text-ink-900">Doctor requests</h2>
          {pending.length === 0 && <p className="mt-2 text-sm text-ink-500">No requests waiting.</p>}
          <ul className="mt-3 space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="rounded-2xl border border-[#e6efec] p-4">
                <div className="text-sm font-extrabold text-ink-900">{r.doctor_name} <span className="font-normal text-ink-500">{r.doctor_specialty ?? ""}</span></div>
                <div className="mt-1 text-sm text-ink-700">
                  {r.name}: {pkr(r.price_pkr)} for {r.consultations_total} consultations, {r.members_allowed} people, {modesText(r)}. {r.rollover_allowed ? "Would allow rollover." : "No rollover."} Up to {r.max_families ?? "any number of"} families.
                </div>
                {r.note && <div className="mt-1 text-sm italic text-ink-500">&ldquo;{r.note}&rdquo;</div>}
                <div className="mt-1 text-xs text-ink-500">Sent {fmtDate(r.created_at)}</div>
                {approving?.req.id === r.id ? (
                  <div className="mt-3">
                    <PackForm form={approving.form} setForm={(f) => setApproving({ ...approving, form: f })} doctors={ov.doctors} lockDoctor />
                    <label className="mt-3 block text-xs font-semibold text-ink-700">Note to the doctor (optional)<input value={approving.note} onChange={(e) => setApproving({ ...approving, note: e.target.value })} className={FIELD} /></label>
                    <div className="mt-3 flex gap-3">
                      <button type="button" disabled={busy} className={BTN} onClick={() => run(() => supabase!.rpc("admin_package_decide_request", { p_request_id: r.id, p_approve: true, p_data: toData(approving.form), p_note: approving.note || null }), "Approved. The pack is live for this doctor.", () => setApproving(null))}>Approve with these terms</button>
                      <button type="button" className={BTN2} onClick={() => setApproving(null)}>Cancel</button>
                    </div>
                  </div>
                ) : declining?.id === r.id ? (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-ink-700">Reason shown to the doctor<input value={declining.note} onChange={(e) => setDeclining({ ...declining, note: e.target.value })} className={FIELD} /></label>
                    <div className="mt-3 flex gap-3">
                      <button type="button" disabled={busy} className={BTN} onClick={() => run(() => supabase!.rpc("admin_package_decide_request", { p_request_id: r.id, p_approve: false, p_data: {}, p_note: declining.note || null }), "Declined.", () => setDeclining(null))}>Decline request</button>
                      <button type="button" className={BTN2} onClick={() => setDeclining(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-3">
                    <button type="button" className={BTN} onClick={() => setApproving({ req: r, form: fromReq(r), note: "" })}>Approve / edit terms</button>
                    <button type="button" className={BTN2} onClick={() => setDeclining({ id: r.id, note: "" })}>Decline</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {ov.requests.some((r) => r.status !== "pending") && (
            <>
              <h3 className="mt-6 text-sm font-extrabold text-ink-900">Earlier requests</h3>
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {ov.requests.filter((r) => r.status !== "pending").slice(0, 15).map((r) => (
                  <li key={r.id}>{fmtDate(r.created_at)} · {r.doctor_name} · {pkr(r.price_pkr)} · {r.status}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "families" && (
        <>
          {act && act.overdue.length > 0 && (
            <div className={CARD}>
              <h2 className="text-lg font-extrabold text-red-800">Waiting longer than the reply time</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {act.overdue.map((o) => (
                  <li key={o.claim_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 p-3">
                    <span>
                      {o.member_name} is waiting for {o.doctor_name} since {fmtDate(o.waiting_since)} (reply time {o.reply_window_hours}h)
                    </span>
                    <button
                      type="button"
                      className={BTN2}
                      disabled={busy}
                      onClick={() => run(() => supabase!.rpc("admin_package_return_credit", { p_claim_id: o.claim_id, p_reason: "Doctor did not reply in time" }), "Credit returned to the family.")}
                    >
                      Return the credit
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Give a pack by hand</h2>
            <p className="mt-1 text-xs text-ink-500">For pilots and for families who paid the doctor directly. The family needs a registered account.</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-ink-700">
                Pack
                <select value={grant.package_id} onChange={(e) => setGrant({ ...grant, package_id: e.target.value })} className={FIELD}>
                  <option value="">Choose…</option>
                  {ov.packages.filter((p) => p.status !== "archived").map((p) => (
                    <option key={p.id} value={p.id}>{p.doctor_name} - {p.name} ({pkr(p.price_pkr)})</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink-700">Family&rsquo;s account email<input type="email" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} className={FIELD} /></label>
              <label className="block text-xs font-semibold text-ink-700">
                Who brought them
                <select value={grant.source} onChange={(e) => setGrant({ ...grant, source: e.target.value })} className={FIELD}>
                  <option value="platform">Family Medic (doctor gets the lower share)</option>
                  <option value="doctor">The doctor (higher share)</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink-700">Note (optional)<input value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} className={FIELD} /></label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-900">
              <input type="checkbox" checked={grant.collected} onChange={(e) => setGrant({ ...grant, collected: e.target.checked })} className="h-4 w-4" />
              The doctor already collected the payment (nothing is owed to the doctor)
            </label>
            <button
              type="button"
              disabled={busy || !grant.package_id || !grant.email}
              className={`${BTN} mt-4`}
              onClick={() =>
                run(
                  () => supabase!.rpc("admin_package_grant", { p_package_id: grant.package_id, p_email: grant.email, p_source: grant.source, p_doctor_share_pct: null, p_doctor_collected: grant.collected, p_note: grant.note || null }),
                  "Pack given.",
                  () => setGrant({ ...grant, email: "", note: "" })
                )
              }
            >
              Give the pack
            </button>
          </div>

          <div className={CARD}>
            <h2 className="text-lg font-extrabold text-ink-900">Recent purchases (90 days)</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">Bought</th><th>Family</th><th>Doctor</th><th>Price</th><th>Left</th><th>Brought by</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {(act?.purchases ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-[#e6efec] align-top">
                      <td className="py-2">{fmtDate(p.created_at)}<div className="text-[11px] text-ink-500">{p.payment_method}</div></td>
                      <td className="font-semibold text-ink-900">{p.family_name}<div className="text-[11px] font-normal text-ink-500">{p.email}</div></td>
                      <td>{p.doctor_name}</td>
                      <td>{pkr(p.price_pkr)}</td>
                      <td>{p.credits_left}/{p.credits_total}</td>
                      <td>
                        {p.source === "doctor" ? "Doctor" : "Platform"} {p.doctor_share_pct}%
                        <div className="text-[11px] text-ink-500">{p.source_reason}</div>
                      </td>
                      <td>{p.status}{p.doctor_paid_at ? " · doctor paid" : ""}</td>
                      <td className="space-x-1 whitespace-nowrap text-right">
                        <button type="button" className={BTN2} onClick={() => setSrcEdit({ id: p.id, source: p.source === "doctor" ? "platform" : "doctor", reason: "" })}>Change who</button>
                        {p.status === "active" && <button type="button" className={BTN2} onClick={async () => {
                          const s = await supabase!.rpc("admin_package_refund_suggestion", { p_purchase_id: p.id });
                          setRefund({ id: p.id, amount: String(typeof s.data === "number" ? s.data : 0), note: "" });
                        }}>Refund</button>}
                      </td>
                    </tr>
                  ))}
                  {(act?.purchases ?? []).length === 0 && <tr><td colSpan={8} className="py-3 text-ink-500">No purchases yet.</td></tr>}
                </tbody>
              </table>
            </div>

            {srcEdit && (
              <div className="mt-4 rounded-2xl bg-[#f5faf8] p-4">
                <div className="text-sm font-extrabold text-ink-900">Change who brought this family</div>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block text-xs font-semibold text-ink-700">
                    Brought by
                    <select value={srcEdit.source} onChange={(e) => setSrcEdit({ ...srcEdit, source: e.target.value })} className={FIELD}>
                      <option value="doctor">The doctor</option>
                      <option value="platform">Family Medic</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-ink-700 sm:col-span-2">Reason (saved with the purchase)<input value={srcEdit.reason} onChange={(e) => setSrcEdit({ ...srcEdit, reason: e.target.value })} className={FIELD} /></label>
                </div>
                <div className="mt-3 flex gap-3">
                  <button type="button" disabled={busy || srcEdit.reason.trim().length < 3} className={BTN} onClick={() => run(() => supabase!.rpc("admin_package_set_source", { p_purchase_id: srcEdit.id, p_source: srcEdit.source, p_reason: srcEdit.reason }), "Updated. The doctor's share was recalculated.", () => setSrcEdit(null))}>Save change</button>
                  <button type="button" className={BTN2} onClick={() => setSrcEdit(null)}>Cancel</button>
                </div>
              </div>
            )}
            {refund && (
              <div className="mt-4 rounded-2xl bg-[#fffaf0] p-4">
                <div className="text-sm font-extrabold text-ink-900">Record a refund</div>
                <p className="mt-1 text-xs text-ink-500">This ends the pack and lowers the doctor&rsquo;s share. Return the money to the family in the Safepay dashboard as you do for other refunds. The amount below is the unused part.</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block text-xs font-semibold text-ink-700">Refund (PKR)<input type="number" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} className={FIELD} /></label>
                  <label className="block text-xs font-semibold text-ink-700 sm:col-span-2">Note<input value={refund.note} onChange={(e) => setRefund({ ...refund, note: e.target.value })} className={FIELD} /></label>
                </div>
                <div className="mt-3 flex gap-3">
                  <button type="button" disabled={busy} className={BTN} onClick={() => run(() => supabase!.rpc("admin_package_refund", { p_purchase_id: refund.id, p_refund_pkr: Number(refund.amount) || 0, p_note: refund.note || null }), "Refund recorded and the pack ended.", () => setRefund(null))}>Record refund</button>
                  <button type="button" className={BTN2} onClick={() => setRefund(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "payouts" && (
        <div className={CARD}>
          <h2 className="text-lg font-extrabold text-ink-900">What each doctor is owed</h2>
          <p className="mt-1 text-xs text-ink-500">Pay the doctor yourself (bank or JazzCash), then press the button to record it. A refund after payment shows as a deduction and is netted off the next payout.</p>
          {pay.length === 0 && <p className="mt-3 text-sm text-ink-500">No pack sales yet.</p>}
          <ul className="mt-3 space-y-3">
            {pay.map((d) => (
              <li key={d.doctor_id} className="rounded-2xl border border-[#e6efec] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-ink-900">{d.doctor_name}</div>
                    <div className="text-xs text-ink-500">{d.packs} pack{d.packs === 1 ? "" : "s"} · earned {pkr(d.earned_pkr)} · paid {pkr(d.paid_pkr)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-base font-extrabold ${d.owed_pkr > 0 ? "text-teal-800" : d.owed_pkr < 0 ? "text-red-700" : "text-ink-500"}`}>{d.owed_pkr < 0 ? `Deduct ${pkr(-d.owed_pkr)}` : `Owed ${pkr(d.owed_pkr)}`}</span>
                    <button type="button" className={BTN2} onClick={() => setOpenDoc(openDoc === d.doctor_id ? null : d.doctor_id)}>{openDoc === d.doctor_id ? "Hide" : "Details"}</button>
                    {d.owed_pkr !== 0 && <button type="button" className={BTN} onClick={() => setMarkPaid({ doctor: d.doctor_id, net: d.owed_pkr, note: "" })}>Mark paid</button>}
                  </div>
                </div>
                {markPaid?.doctor === d.doctor_id && (
                  <div className="mt-3 rounded-xl bg-[#f5faf8] p-3">
                    <p className="text-sm text-ink-900">Record that {d.doctor_name} was paid {pkr(markPaid.net)}?</p>
                    <label className="mt-2 block text-xs font-semibold text-ink-700">Note (bank reference, optional)<input value={markPaid.note} onChange={(e) => setMarkPaid({ ...markPaid, note: e.target.value })} className={FIELD} /></label>
                    <div className="mt-3 flex gap-3">
                      <button type="button" disabled={busy} className={BTN} onClick={() => run(() => supabase!.rpc("admin_package_mark_paid", { p_doctor_id: d.doctor_id, p_expected_net_pkr: markPaid.net, p_note: markPaid.note || null }), "Recorded as paid.", () => setMarkPaid(null))}>Yes, mark paid</button>
                      <button type="button" className={BTN2} onClick={() => setMarkPaid(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {openDoc === d.doctor_id && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-xs">
                      <thead className="uppercase tracking-wide text-ink-500"><tr><th className="py-1">Bought</th><th>Family</th><th>Price</th><th>Brought by</th><th>Share</th><th>Paid</th><th>Owed</th></tr></thead>
                      <tbody>
                        {d.lines.map((l) => (
                          <tr key={l.id} className="border-t border-[#e6efec]">
                            <td className="py-1">{fmtDate(l.created_at)}</td>
                            <td>{l.family}</td>
                            <td>{pkr(l.price_pkr)}{l.refund_pkr ? ` (refund ${pkr(l.refund_pkr)})` : ""}</td>
                            <td>{l.source === "doctor" ? "Doctor" : "Platform"} {l.share_pct}%</td>
                            <td>{pkr(l.share_pkr)}</td>
                            <td>{pkr(l.paid_pkr)}</td>
                            <td>{pkr(l.owed_pkr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AdminPackages() {
  return (
    <AdminGuard title="Family Packs">
      {() => (
        <div>
          <PageHeader title="Family Packs" subtitle="Create packs for doctors, review their requests, and keep track of families and payouts." />
          <Inner />
        </div>
      )}
    </AdminGuard>
  );
}
