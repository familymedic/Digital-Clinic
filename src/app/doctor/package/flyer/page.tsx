"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DoctorShell from "@/components/DoctorShell";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { useDoctorProfileWithSignOut } from "@/lib/doctor";
import { displayName, loadCardFonts, loadCardPhoto, type CardDoctor } from "@/lib/doctorCard";
import {
  FLYER_SIZES,
  buildFlyerCaption,
  drawPackFlyer,
  packFlyerLink,
  type FlyerKind,
  type FlyerPack,
} from "@/lib/packFlyer";

// Doctor pack flyer (2026-10-26). Lives under /doctor/package/ (a doctor
// workspace page, not tracked as a public page). Everything happens in the
// doctor's own browser: the flyer is drawn on a canvas from the doctor's public
// directory row and their own live pack, so it is always up to date, then
// downloaded or shared by the doctor. Nothing is posted for them and nothing is
// stored on the server. The flyer shows no price on purpose: the price is on the
// page the QR code opens.

interface PackState {
  sales_open: boolean;
  package: (FlyerPack & { status: "draft" | "active" | "paused" | "archived" }) | null;
  ref_code: string | null;
}

const CHOICES: { key: FlyerKind; label: string }[] = [
  { key: "feed", label: "Feed post" },
  { key: "story", label: "Story / WhatsApp status" },
  { key: "print", label: "Print (A4)" },
];

export default function DoctorPackFlyer() {
  const { session, authLoading, profile, profileChecking, error: profileError, signOut } = useDoctorProfileWithSignOut();

  const [doctor, setDoctor] = useState<CardDoctor | null | undefined>(undefined);
  const [st, setSt] = useState<PackState | null | undefined>(undefined);
  const [code, setCode] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [photoTried, setPhotoTried] = useState(false);
  const [kind, setKind] = useState<FlyerKind>("feed");
  const [edit, setEdit] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Phones can hand the image straight to WhatsApp/Instagram. Evaluated once in the browser;
  // the buttons only appear after the page's data has loaded, so there is no server/browser mismatch.
  const [canShare] = useState(() => {
    try {
      if (typeof navigator === "undefined" || !navigator.canShare) return false;
      const f = new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" });
      return navigator.canShare({ files: [f] });
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The doctor's public facts (same row patients see).
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

  // The doctor's own pack + personal code + the admin switch.
  useEffect(() => {
    if (!profile || !supabase) return;
    let cancelled = false;
    (async () => {
      const client = supabase!;
      const s = await client.rpc("doctor_package_my_state");
      if (cancelled) return;
      if (s.error || !s.data || typeof s.data !== "object") {
        setSt(null);
        return;
      }
      const state = s.data as PackState;
      setSt(state);
      const sw = await client.rpc("package_flyer_enabled");
      if (!cancelled && !sw.error && typeof sw.data === "boolean") setEnabled(sw.data);
      if (state.package && state.package.status === "active") {
        let c = state.ref_code;
        if (!c) {
          // Created the first time it is needed, exactly like "Copy my pack link".
          const r = await client.rpc("doctor_package_ref_code");
          if (!r.error && typeof r.data === "string" && r.data) c = r.data;
        }
        if (!cancelled) setCode(c);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!doctor) return;
    let cancelled = false;
    loadCardPhoto(doctor.profile_photo_url).then((p) => {
      if (cancelled) return;
      setPhoto(p);
      setPhotoTried(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doctor]);

  const pk = st?.package && st.package.status === "active" ? st.package : null;
  const ready = !!(doctor && pk && code && enabled);

  const redraw = useCallback(async () => {
    if (!doctor || !pk || !code || !canvasRef.current || !photoTried) return;
    await loadCardFonts();
    if (!canvasRef.current) return;
    drawPackFlyer(canvasRef.current, kind, { doctor, pack: pk, photo, code });
  }, [doctor, pk, code, photo, photoTried, kind]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  const link = doctor && code ? packFlyerLink(doctor.id, code) : "";
  const caption = doctor && pk && code ? (edit ?? buildFlyerCaption(doctor, pk, link)) : "";
  const fileName = doctor
    ? `family-medic-pack-${displayName(doctor.full_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${kind}.png`
    : "family-medic-pack-flyer.png";
  // A flyer is only useful (and honest) while a scan can lead to a purchase.
  const live = !!st?.sales_open;

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

  const shellProps = { active: "package" as const };

  if (!isDatabaseConfigured) {
    return (
      <DoctorShell {...shellProps}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The database isn&rsquo;t connected yet.</div>
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
        <div className="mx-auto max-w-md rounded-3xl border border-[#dcebe6] bg-white p-6 text-sm text-ink-700">
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
        <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&rsquo;t verify your doctor account: {profileError}</div>
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
  const size = FLYER_SIZES[kind];
  const NOTICE = "mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900";

  return (
    <DoctorShell {...shell}>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">My pack flyer</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-500">
        A ready-made flyer for your Family Pack: your photo and profile, what your pack includes, and a QR code that opens your pack page. It updates by itself when your pack terms change. The price is not printed on
        it &mdash; families see the current price on your page after they scan. You decide when and where to share it; nothing is posted for you.
      </p>

      {loadError && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn&rsquo;t load your details: {loadError}</div>}
      {(doctor === undefined || st === undefined) && !loadError && <p className="mt-6 text-sm text-ink-500">Loading…</p>}

      {st !== undefined && !enabled && (
        <div className={NOTICE}>The pack flyer is switched off by Family Medic for now. Please check back later.</div>
      )}

      {st !== undefined && enabled && st === null && (
        <div className={NOTICE}>Family Packs are not available on your account yet.</div>
      )}

      {st && enabled && !st.package && (
        <div className={NOTICE}>
          You don&rsquo;t have a Family Pack yet. Ask for one on the{" "}
          <Link href="/doctor/package" className="font-semibold underline underline-offset-2">
            Family Pack page
          </Link>{" "}
          and your flyer will be ready here once Family Medic approves it.
        </div>
      )}

      {st && enabled && st.package && !pk && (
        <div className={NOTICE}>
          Your pack is not taking new families right now ({st.package.status === "paused" ? "paused" : st.package.status}), so there is no flyer to share.{" "}
          <Link href="/doctor/package" className="font-semibold underline underline-offset-2">
            Back to the Family Pack page
          </Link>
        </div>
      )}

      {doctor === null && !loadError && (
        <div className={NOTICE}>
          Your profile isn&rsquo;t listed on the public doctors page yet, so there is no flyer to make. Once you appear under{" "}
          <Link href="/doctors" className="font-semibold underline underline-offset-2">
            Our Doctors
          </Link>
          , it will be ready here.
        </div>
      )}

      {doctor && pk && enabled && (
        <>
          {!live && (
            <div className={NOTICE}>
              Family Pack sales are not open to the public yet, so a scan would not lead to a pack. You can preview your flyer now; downloading opens when Family Medic switches sales on.
            </div>
          )}
          {!doctor.profile_photo_url && (
            <div className={NOTICE}>
              Your flyer shows your initials for now.{" "}
              <Link href="/doctor/profile" className="font-semibold underline underline-offset-2">
                Add your photo in My Profile
              </Link>{" "}
              (once it is approved it appears on the flyer automatically). A photo makes the flyer much more personal.
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.key}
                onClick={() => setKind(c.key)}
                className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                  kind === c.key ? "border-[#0a3733] bg-[#0a3733] text-white" : "border-ink-border bg-white text-ink-700 hover:border-teal-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            {size.hint} · {size.w}×{size.h}
          </p>

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
            <div className="rounded-[28px] bg-white p-4 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] sm:p-6">
              <canvas
                ref={canvasRef}
                className="mx-auto block h-auto w-full rounded-2xl"
                style={{ maxWidth: kind === "feed" ? 560 : 380 }}
                aria-label="Preview of your pack flyer"
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={download}
                  disabled={busy || !photoTried || !live}
                  className="rounded-full bg-[#ffb454] px-6 py-3 text-sm font-bold text-[#3b2500] shadow-sm transition hover:bg-[#ffc272] disabled:opacity-60"
                >
                  {busy ? "Preparing…" : "Download flyer (PNG)"}
                </button>
                {canShare && (
                  <button
                    onClick={share}
                    disabled={!live}
                    className="rounded-full border border-[#0a3733] px-6 py-3 text-sm font-bold text-[#0a3733] transition hover:bg-[#eaf7f2] disabled:opacity-60"
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
                onChange={(e) => setEdit(e.target.value)}
                rows={14}
                className="mt-3 w-full rounded-2xl border border-ink-border bg-[#f7fbf9] p-3 text-[13.5px] leading-relaxed text-ink-700 focus:border-teal-600 focus:outline-none"
              />
              <p className="mt-2 text-xs text-ink-500">
                The link in the caption and the QR on the flyer both open your pack page. Families who buy through them count as families you brought.
              </p>
              <ul className="mt-4 space-y-1.5 text-xs text-ink-500">
                <li>• If you pause your pack, an old printed flyer will lead to a page that says you are not offering a pack right now.</li>
                <li>• Instagram captions can&rsquo;t hold clickable links — put the link in your bio, or let people scan the QR.</li>
                <li>• Please keep to your medical council&rsquo;s rules on advertising when you post or print this.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </DoctorShell>
  );
}
