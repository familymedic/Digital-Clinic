"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";

// Doctor public profile page (2026-09-23). The /doctors directory card
// only ever showed a 3-line-clamped bio with no way to read the rest —
// flagged directly by the physician: "i cannot open the doctor profile
// as general client to read complete bio of any doctor." Reuses the
// same public_doctor_directory view (0028/0034) the directory already
// queries — that view already carries the full, un-truncated bio, so
// this page needs no new migration or API route, just a place to show
// it in full. Same "not live until approved" rule already enforced by
// the view: a doctor with no approved profile just shows the fields
// that are public (name/specialty/fee), same as their directory card.

interface DirectoryDoctor {
  id: string;
  full_name: string;
  specialty: string | null;
  consultation_fee: number | null;
  bio: string | null;
  years_of_experience: number | null;
  credentials: string | null;
  profile_photo_url: string | null;
}

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface Availability {
  doctor_id: string;
  daily_full: boolean;
  text_open_now: boolean;
  text_opens_in_minutes: number | null;
  text_spots_left: number | null;
  next_call_start: string | null;
}

function pktDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}

function formatCallTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit" }).format(d);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (pktDateKey(d) === pktDateKey(now)) return `Today ${time}`;
  if (pktDateKey(d) === pktDateKey(tomorrow)) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" }).format(d);
  return `${day}, ${time}`;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function HeroShell({ children }: { children?: React.ReactNode }) {
  return (
    <section className="bg-[radial-gradient(900px_420px_at_85%_-10%,rgba(45,212,191,0.28),transparent_60%),linear-gradient(180deg,#0a3733,#072927)] pb-28 pt-8 sm:pb-32 sm:pt-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Link href="/doctors" className="text-sm font-semibold text-teal-200 hover:text-white">
          &larr; All doctors
        </Link>
        {children}
      </div>
    </section>
  );
}

export default function DoctorProfile() {
  const params = useParams<{ id: string }>();
  const [doctor, setDoctor] = useState<DirectoryDoctor | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client || !params.id) return;
    (async () => {
      const base = "id, full_name, specialty, consultation_fee, bio, years_of_experience, profile_photo_url";
      // `credentials` arrives with migration 0067; fall back if not applied yet.
      let res: { data: unknown; error: { message: string } | null } = await client
        .from("public_doctor_directory")
        .select(`${base}, credentials`)
        .eq("id", params.id)
        .maybeSingle();
      if (res.error && /credentials/.test(res.error.message)) {
        res = await client.from("public_doctor_directory").select(base).eq("id", params.id).maybeSingle();
      }
      if (res.error) {
        setError(res.error.message);
      } else {
        setDoctor((res.data as unknown as DirectoryDoctor | null) ?? null);
      }
    })();
  }, [params.id]);

  // Availability is a nice-to-have: fail soft, never block the profile.
  useEffect(() => {
    const client = supabase;
    if (!client || !params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: rpcError } = await client.rpc("list_available_doctors");
        if (cancelled || rpcError || !data) return;
        const row = (data as Availability[]).find((r) => r.doctor_id === params.id);
        setAvail(row ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (!isDatabaseConfigured) {
    return (
      <div>
        <HeroShell>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white">Doctor profile</h1>
        </HeroShell>
        <div className="mx-auto -mt-16 max-w-2xl px-4 pb-16 sm:px-6">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            The database isn&rsquo;t connected yet, so there&rsquo;s nothing to show here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeroShell>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Doctor profile
        </h1>
      </HeroShell>

      <div className="mx-auto -mt-16 max-w-6xl px-4 pb-20 sm:px-6">
        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            Couldn&rsquo;t load this doctor&rsquo;s profile: {error}
          </div>
        )}

        {doctor === undefined && !error && (
          <div className="rounded-3xl bg-white p-8 text-sm text-ink-500 shadow-[0_20px_50px_-24px_rgba(7,41,39,0.35)]">Loading…</div>
        )}

        {doctor === null && !error && (
          <div className="rounded-3xl border border-dashed border-ink-border bg-white p-10 text-center text-sm text-ink-500">
            We couldn&rsquo;t find that doctor — they may no longer be available for booking.
            <div className="mt-4">
              <Link href="/doctors" className="font-semibold text-teal-700 hover:text-teal-800">
                Browse our doctors →
              </Link>
            </div>
          </div>
        )}

        {doctor && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
            <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(7,41,39,0.35)] sm:p-9">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                {doctor.profile_photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={doctor.profile_photo_url}
                    alt={doctor.full_name}
                    className="h-28 w-28 shrink-0 rounded-[28px] object-cover"
                  />
                ) : (
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[28px] bg-gradient-to-br from-teal-300 to-teal-700 text-4xl font-extrabold text-[#06312e]">
                    {initials(doctor.full_name)}
                  </div>
                )}
                <div>
                  <div className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">
                    ✓ PMDC verified
                  </div>
                  <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">{doctor.full_name}</h2>
                  <div className="mt-1 text-[15px] text-ink-500">
                    {doctor.specialty ?? "General Practice"}
                    {doctor.years_of_experience != null && <> · {doctor.years_of_experience} yrs experience</>}
                  </div>
                  {doctor.credentials && <div className="mt-1 text-[15px] font-bold text-teal-800">{doctor.credentials}</div>}
                </div>
              </div>

              <div className="mt-8 border-t border-[#e6efec] pt-7">
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-teal-700">About</h3>
                {doctor.bio ? (
                  <p className="mt-3 whitespace-pre-line text-[15.5px] leading-relaxed text-ink-700">{doctor.bio}</p>
                ) : (
                  <p className="mt-3 text-sm text-ink-500">This doctor hasn&rsquo;t added a personal bio yet.</p>
                )}
              </div>
            </div>

            <aside className="rounded-[28px] bg-[#0a3733] p-6 text-white shadow-[0_24px_60px_-24px_rgba(7,41,39,0.6)] lg:sticky lg:top-36">
              <div className="text-xs font-bold uppercase tracking-wider text-teal-200">Consultation fee</div>
              <div className="mt-1 text-4xl font-extrabold">PKR {doctor.consultation_fee ?? "—"}</div>

              <div className="mt-5 space-y-2 rounded-2xl bg-white/10 p-4 text-[13.5px]">
                {avail ? (
                  avail.daily_full ? (
                    <div className="font-semibold text-amber-200">Fully booked for today — bookings reopen tomorrow</div>
                  ) : (
                    <>
                      <div className={`flex items-center gap-2 ${avail.text_open_now ? "font-bold text-emerald-300" : "text-teal-100/80"}`}>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${avail.text_open_now ? "bg-emerald-400" : avail.text_opens_in_minutes !== null ? "bg-amber-400" : "bg-slate-400"}`}
                        />
                        {avail.text_open_now
                          ? `Text: open now${avail.text_spots_left !== null ? ` · ${avail.text_spots_left} spot${avail.text_spots_left === 1 ? "" : "s"} left today` : ""}`
                          : avail.text_opens_in_minutes !== null
                            ? `Text: opens in ${formatMinutes(avail.text_opens_in_minutes)}`
                            : "Text: closed for today"}
                      </div>
                      <div className="flex items-center gap-2 text-teal-50">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                          <rect x="3" y="6" width="13" height="12" rx="2" />
                          <path d="M16 10l5-3v10l-5-3z" />
                        </svg>
                        {avail.next_call_start ? `Audio/Video: next slot ${formatCallTime(avail.next_call_start)}` : "Audio/Video: no open slots"}
                      </div>
                    </>
                  )
                ) : (
                  <div className="text-teal-100/80">Video, audio or text — choose a time when you book.</div>
                )}
              </div>

              <Link
                href={`/book?doctorId=${doctor.id}`}
                className="mt-5 block rounded-full bg-[#ffb454] px-5 py-3.5 text-center text-[15px] font-extrabold text-[#3b2500] shadow-[0_8px_20px_-8px_rgba(255,180,84,0.8)] transition hover:bg-[#ffc272]"
              >
                Book a consultation
              </Link>
              <p className="mt-4 text-center text-xs text-teal-100/80">For emergencies, call 1122 — don&rsquo;t wait for an online visit.</p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
