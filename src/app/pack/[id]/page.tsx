"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIP_LABEL } from "@/lib/family";
import { fmtDate, useMyPacks } from "@/lib/packages";

// One-tap start of a pack consultation (migration 0089): choose who it is for,
// choose text / audio / video, say briefly what the problem is, go. No payment
// step and no booking for text. Audio and video need a free time from the
// doctor's own times. Everything is decided by package_start_consultation in
// the database; this screen only shows the choices.

interface Person {
  id: string;
  full_name: string;
  relationship: string;
}
interface Slot {
  id: string;
  doctor_id: string;
  start_time: string;
  remaining: number;
}

const CARD = "rounded-[26px] bg-white p-5 shadow-[0_10px_30px_rgba(10,55,51,0.07)] sm:p-6";

function fmtSlot(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export default function StartPackConsultation() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { packs } = useMyPacks();
  const pack = useMemo(() => packs?.find((p) => p.id === params.id) ?? null, [packs, params.id]);

  const [people, setPeople] = useState<Person[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [memberId, setMemberId] = useState("");
  const [mode, setMode] = useState<"text" | "audio" | "video">("text");
  const [slotId, setSlotId] = useState("");
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const userId = session?.user.id;
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    Promise.resolve(
      supabase.from("family_members").select("id, full_name, relationship").eq("account_id", userId).is("archived_at", null).order("created_at", { ascending: true })
    ).then(({ data }) => {
      if (!cancelled) setPeople((data ?? []) as Person[]);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const doctorId = pack?.doctor.id;
  const needsCall = mode !== "text";
  useEffect(() => {
    if (!supabase || !doctorId || !needsCall) return;
    let cancelled = false;
    Promise.resolve(supabase.rpc("list_open_slots")).then(({ data }) => {
      if (cancelled) return;
      setSlots(((data ?? []) as Slot[]).filter((s) => s.doctor_id === doctorId));
    });
    return () => {
      cancelled = true;
    };
  }, [doctorId, needsCall]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <PageHeader title="Start a consultation" />
        <p className="mx-auto max-w-2xl px-4 py-12 text-sm text-ink-500">The database isn&rsquo;t connected yet.</p>
      </div>
    );
  }
  if (authLoading || packs === null) {
    return (
      <div>
        <PageHeader title="Start a consultation" />
        <p className="mx-auto max-w-2xl px-4 py-12 text-sm text-ink-500">Loading…</p>
      </div>
    );
  }
  if (!session) {
    return (
      <div>
        <PageHeader title="Start a consultation" />
        <div className="mx-auto max-w-md px-4 py-12">
          <div className={CARD}>
            <p className="text-sm text-ink-700">Please log in to use your Family Pack.</p>
            <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-teal-700 underline underline-offset-2">Log in</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!pack || !pack.is_live) {
    return (
      <div>
        <PageHeader title="Start a consultation" />
        <div className="mx-auto max-w-md px-4 py-12">
          <div className={CARD}>
            <p className="text-sm text-ink-700">{pack ? "This pack has ended." : "We couldn't find that pack on your account."}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold text-teal-700 underline underline-offset-2">Back to my dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  const usedIds = new Set(pack.members_used.map((m) => m.id));
  const placesFull = pack.members_used.length >= pack.members_allowed;
  const selectable = (p: Person) => usedIds.has(p.id) || !placesFull;
  const audioLeft = pack.audio_limit == null ? Infinity : pack.audio_limit - pack.audio_used;
  const videoLeft = pack.video_limit == null ? Infinity : pack.video_limit - pack.video_used;
  const modeOptions = [
    { key: "text" as const, label: "Text and voice notes", hint: "Starts right away", ok: pack.allow_text },
    { key: "audio" as const, label: "Audio call", hint: audioLeft === Infinity ? "Choose a time" : `Choose a time (${audioLeft} left)`, ok: pack.allow_audio && audioLeft > 0 },
    { key: "video" as const, label: "Video call", hint: videoLeft === Infinity ? "Choose a time" : `Choose a time (${videoLeft} left)`, ok: pack.allow_video && videoLeft > 0 },
  ].filter((m) => m.ok);

  const chosenMember = people.find((p) => p.id === memberId);
  const canStart = !!chosenMember && complaint.trim().length > 0 && (mode === "text" || !!slotId) && !busy;

  async function start() {
    if (!supabase || !pack || !canStart) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("package_start_consultation", {
      p_purchase_id: pack.id,
      p_member_id: memberId,
      p_mode: mode,
      p_complaint: complaint.trim(),
      p_slot_id: mode === "text" ? null : slotId,
    });
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Something went wrong. Please try again.");
      return;
    }
    router.push(mode === "text" ? `/consultation/${data as string}/messages` : "/dashboard");
  }

  return (
    <div>
      <PageHeader title="Start a consultation" subtitle={`${pack.doctor.name} · ${pack.credits_left} consultation${pack.credits_left === 1 ? "" : "s"} left`} />
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="text-sm font-medium text-teal-700 underline underline-offset-2">← Back to dashboard</Link>

        <div className={CARD}>
          <h2 className="text-base font-extrabold text-ink-900">Who is it for?</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!selectable(p)}
                onClick={() => setMemberId(p.id)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${memberId === p.id ? "border-teal-700 bg-teal-700 text-white" : "border-[#d7e7e2] bg-white text-ink-900"} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {p.full_name} <span className="font-normal opacity-70">({RELATIONSHIP_LABEL[p.relationship] ?? p.relationship})</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            {placesFull
              ? `All ${pack.members_allowed} places on this pack are taken, so only the people who already used it can.`
              : `This pack covers up to ${pack.members_allowed} people. ${pack.members_used.length} place${pack.members_used.length === 1 ? " is" : "s are"} used so far.`}{" "}
            Need to add someone? <Link href="/dashboard" className="font-semibold text-teal-700 underline underline-offset-2">Add a family member</Link>.
          </p>
        </div>

        <div className={CARD}>
          <h2 className="text-base font-extrabold text-ink-900">How would you like to talk?</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {modeOptions.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMode(m.key);
                  setSlotId("");
                }}
                className={`rounded-2xl border p-3 text-left transition ${mode === m.key ? "border-teal-700 bg-teal-50" : "border-[#d7e7e2] bg-white"}`}
              >
                <div className="text-sm font-extrabold text-ink-900">{m.label}</div>
                <div className="text-xs text-ink-500">{m.hint}</div>
              </button>
            ))}
          </div>
          {mode === "text" && (
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              You can write or record a voice note at any time. The doctor replies during working hours, so a message sent at night is answered the next working day. This is not for emergencies: in an emergency call 1122
              or go to the nearest hospital.
            </p>
          )}
          {mode !== "text" && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-ink-700">Choose a time (Pakistan time)</div>
              {slots.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">The doctor has no open times right now. Try text, or check again later.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.slice(0, 24).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSlotId(s.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${slotId === s.id ? "border-teal-700 bg-teal-700 text-white" : "border-[#d7e7e2] bg-white text-ink-900"}`}
                    >
                      {fmtSlot(s.start_time)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={CARD}>
          <h2 className="text-base font-extrabold text-ink-900">What is the problem?</h2>
          <textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="A few words for the doctor, for example: fever and cough for two days"
            className="mt-3 w-full rounded-xl border border-[#d7e7e2] px-3 py-2 text-sm"
          />
          {err && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{err}</p>}
          <button
            type="button"
            disabled={!canStart}
            onClick={start}
            className="mt-4 rounded-full bg-[#ffb454] px-6 py-3 text-sm font-extrabold text-[#3b2500] shadow-[0_8px_20px_-10px_rgba(255,180,84,0.9)] hover:bg-[#ffc272] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting…" : mode === "text" ? "Start now" : "Book this time"}
          </button>
          <p className="mt-2 text-xs text-ink-500">This uses 1 of your {pack.credits_left} remaining consultations. Your pack ends {fmtDate(pack.expires_at)}.</p>
        </div>
      </div>
    </div>
  );
}
