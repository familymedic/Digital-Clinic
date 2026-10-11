"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import {
  CARD_SIZES,
  buildCaption,
  displayName,
  drawDoctorCard,
  loadCardFonts,
  loadCardPhoto,
  type CardDoctor,
  type CardKind,
  type CardPlatform,
} from "@/lib/doctorCard";

// Doctor share card (2026-10-11). Lives under /doctor/profile/ on purpose so
// it is covered by the same "doctor workspace, not tracked as a public page"
// rule as the profile page. Everything happens in the doctor's own browser:
// the card is drawn on a canvas from the same public directory row patients
// already see, then downloaded or shared by the doctor. Nothing is posted
// anywhere automatically and nothing is stored on the server.

interface Choice {
  key: string;
  label: string;
  hint: string;
  kind: CardKind;
  platform: CardPlatform;
}

const CHOICES: Choice[] = [
  { key: "linkedin", label: "LinkedIn", hint: "Wide card for a LinkedIn post", kind: "linkedin", platform: "linkedin" },
  { key: "instagram", label: "Instagram post", hint: "Square card", kind: "square", platform: "instagram" },
  { key: "facebook", label: "Facebook post", hint: "Square card", kind: "square", platform: "facebook" },
  { key: "story", label: "Story / WhatsApp status", hint: "Tall card", kind: "story", platform: "story" },
];

export default function DoctorShareCard() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } = useDoctorProfileWithSignOut();

  const [doctor, setDoctor] = useState<CardDoctor | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [photoTried, setPhotoTried] = useState(false);
  const [choiceKey, setChoiceKey] = useState("linkedin");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const choice = CHOICES.find((c) => c.key === choiceKey) ?? CHOICES[0];

  // Load this doctor's own PUBLIC directory row (same data patients see).
  useEffect(() => {
    if (!profile || !supabase) return;
    let cancelled = false;
    (async () => {
      const client = supabase!;
      const base = "id, full_name, specialty, years_of_experience, profile_photo_url";
      let res = await client.from("public_doctor_directory").select(`${base}, credentials`).eq("id", profile.id).maybeSingle();
      if (res.error && /credentials/.test(res.error.message)) {
        res = (await client.from("public_doctor_directory").select(base).eq("id", profile.id).maybeSingle()) as typeof res;
      }
      if (cancelled) return;
      if (res.error) {
        setLoadError(res.error.message);
        return;
      }
      const row = res.data as unknown as (Partial<CardDoctor> & { id: string; full_name: string }) | null;
      setDoctor(
        row
          ? {
              id: row.id,
              full_name: row.full_name,
              specialty: row.specialty ?? null,
              years_of_experience: row.years_of_experience ?? null,
              credentials: row.credentials ?? null,
              profile_photo_url: row.profile_photo_url ?? null,
            }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Photo (fails soft → initials).
  useEffect(() => {
    if (!doctor) return;
    let cancelled = false;
    setPhotoTried(false);
    loadCardPhoto(doctor.profile_photo_url).then((p) => {
      if (cancelled) return;
      setPhoto(p);
      setPhotoTried(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doctor]);

  const redraw = useCallback(async () => {
    if (!doctor || !canvasRef.current || !photoTried) return;
    await loadCardFonts();
    if (!canvasRef.current) return;
    drawDoctorCard(canvasRef.current, choice.kind, { doctor, photo });
  }, [doctor, photo, photoTried, choice.kind]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    // Phones can hand the image straight to Instagram/WhatsApp/etc.
    try {
      const f = new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" });
      setCanShare(typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [f] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  const caption = doctor ? (edits[choice.key] ?? buildCaption(doctor, choice.platform)) : "";
  const fileName = doctor
    ? `family-medic-${displayName(doctor.full_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${choice.key}.png`
    : "family-medic-card.png";

  function toBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!canvasRef.current) return resolve(null);
      canvasRef.current.toBlob((b) => resolve(b), "image/png");
    });
  }

  async function download() {
    setNote(null);
    setBusy(true);
    const blob = await toBlob();
    setBusy(false);
    if (!blob) {
      setNote("Couldn't create the image — please try again.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function share() {
    setNote(null);
    const blob = await toBlob();
    if (!blob) return;
    try {
      const file = new File([blob], fileName, { type: "image/png" });
      await navigator.share({ files: [file], text: caption });
    } catch {
      /* cancelled or unsupported — the download button still works */
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote("Couldn't copy automatically — select the text and copy it.");
    }
  }

  const shellProps = { active: "card" as const };

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell {...shellProps}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
        </div>
      </DoctorShell>
    );
  }
  if (authLoading || profileChecking) {
    return (
      <DoctorShell {...shellProps}>
        <p className="text-sm text-ink-500">Loading…</p>
      </DoctorShell>
    );
  }
  if (!session) {
    return (
      <DoctorShell {...shellProps}>
        <div className="mx-auto max-w-md rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-700 shadow-[0_10px_30px_-22px_rgba(7,41,39,0.35)]">
          <p>Please log in with your doctor account first.</p>
          <Link href="/doctor/login" className="mt-4 inline-block font-semibold text-teal-700 underline underline-offset-2">
            Doctor log in
          </Link>
        </div>
      </DoctorShell>
    );
  }
  if (profileError) {
    return (
      <DoctorShell {...shellProps}>
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t verify your doctor account: {profileError}
        </div>
      </DoctorShell>
    );
  }
  if (!profile) {
    return (
      <DoctorShell {...shellProps}>
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>This account isn&rsquo;t set up as a doctor account.</p>
          <button onClick={() => signOut()} className="mt-4 font-semibold text-teal-700 underline underline-offset-2">
            Log out
          </button>
        </div>
      </DoctorShell>
    );
  }

  const shell = { ...shellProps, doctorName: profile.full_name, onSignOut: signOut, doctorId: profile.id };
  const size = CARD_SIZES[choice.kind];

  return (
    <DoctorShell {...shell}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">Share my card</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-500">
        A ready-made card with your name, specialty and booking link — post it on LinkedIn, Facebook or Instagram so
        people can find you on Family Medic. It uses only what is already on your public profile. You decide when and
        where to post; nothing is posted for you.
      </p>

      {loadError && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn&rsquo;t load your profile details: {loadError}
        </div>
      )}

      {doctor === undefined && !loadError && <p className="mt-6 text-sm text-ink-500">Loading…</p>}

      {doctor === null && !loadError && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your profile isn&rsquo;t listed on the public doctors page yet, so there is no card to make. Once you appear
          under <Link href="/doctors" className="font-semibold underline underline-offset-2">Our Doctors</Link>, your card
          will be ready here.
        </div>
      )}

      {doctor && (
        <>
          {!doctor.profile_photo_url && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Your card shows your initials for now.{" "}
              <Link href="/doctor/profile" className="font-semibold underline underline-offset-2">
                Add your photo in My Profile
              </Link>{" "}
              (once it is approved it appears on the card automatically).
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.key}
                onClick={() => setChoiceKey(c.key)}
                className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                  choiceKey === c.key
                    ? "border-[#0a3733] bg-[#0a3733] text-white"
                    : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            {choice.hint} · {size.w}×{size.h}
          </p>

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
            <div className="rounded-[28px] bg-white p-4 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-6">
              <canvas
                ref={canvasRef}
                className="mx-auto block h-auto w-full rounded-2xl"
                style={{ maxWidth: choice.kind === "story" ? 360 : 640 }}
                aria-label="Preview of your share card"
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={download}
                  disabled={busy || !photoTried}
                  className="rounded-full bg-[#ffb454] px-6 py-3 text-sm font-bold text-[#3b2500] shadow-sm transition hover:bg-[#ffc272] disabled:opacity-60"
                >
                  {busy ? "Preparing…" : "Download card (PNG)"}
                </button>
                {canShare && (
                  <button
                    onClick={share}
                    className="rounded-full border border-[#0a3733] px-6 py-3 text-sm font-bold text-[#0a3733] transition hover:bg-[#eaf7f2]"
                  >
                    Share from my phone
                  </button>
                )}
              </div>
              {note && <p className="mt-3 text-xs font-medium text-amber-800">{note}</p>}
            </div>

            <div className="rounded-[28px] bg-white p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-teal-700">Suggested caption</h2>
                <button onClick={copyCaption} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setEdits((prev) => ({ ...prev, [choice.key]: e.target.value }))}
                rows={14}
                className="mt-3 w-full rounded-2xl border border-ink-border bg-[#f7fbf9] p-3 text-[13.5px] leading-relaxed text-ink-700 focus:border-teal-600 focus:outline-none"
              />
              <p className="mt-2 text-xs text-ink-500">
                Edit it however you like. The link in the caption and the QR on the card both open your Family Medic
                profile.
              </p>
              <ul className="mt-4 space-y-1.5 text-xs text-ink-500">
                <li>• Instagram captions can&rsquo;t hold clickable links — put the link in your bio, or let people scan the QR.</li>
                <li>• Please keep to your medical council&rsquo;s rules on advertising when you post.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </DoctorShell>
  );
}
