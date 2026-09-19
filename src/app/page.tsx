"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";
import AddFamilyMemberForm from "@/components/AddFamilyMemberForm";
import PatientDocuments from "@/components/PatientDocuments";

interface Consultation {
  id: string;
  complaint: string;
  status: string;
  created_at: string;
  history_status: "not_started" | "in_progress" | "completed";
  is_flagged: boolean;
  delivery_mode: "text" | "audio" | "video";
  scheduled_slot: { start_time: string } | { start_time: string }[] | null;
  patient: { full_name: string } | { full_name: string }[] | null;
  // Only ever non-empty once a doctor has Approved & Issued a
  // prescription for this consultation — RLS (0018) only returns an
  // assessment row here once status = 'issued', so this array's
  // presence alone is a safe "has an issued prescription" signal, no
  // separate status check needed.
  assessment: { issued_at: string | null }[] | null;
}

// Free follow-up (2026-09-18) — a voucher the doctor granted from an
// already-completed consultation (see FreeFollowUpVoucher on the
// doctor side). `doctor_name` is filled in separately from the public
// doctor directory (0028) rather than a nested select on
// `doctor_profiles` itself, since a patient has no general read access
// to that table — only the public-safe view.
interface ActiveVoucher {
  id: string;
  note: string | null;
  expires_at: string | null;
  created_at: string;
  doctor_id: string;
  doctor_name: string | null;
  patient: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment required",
  submitted: "Submitted — awaiting next steps",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  submitted: "bg-teal-50 text-teal-800",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-[var(--background)] text-ink-500",
};

const HISTORY_LINK_LABEL: Record<Consultation["history_status"], string> = {
  not_started: "Start history questions",
  in_progress: "Continue history questions",
  completed: "View submitted history",
};

const DELIVERY_MODE_LABEL: Record<Consultation["delivery_mode"], string> = {
  text: "Text",
  audio: "Audio call",
  video: "Video call",
};

const AVATAR_TONES = [
  "from-teal-500 to-teal-700",
  "from-amber-400 to-amber-700",
  "from-indigo-400 to-indigo-700",
  "from-rose-400 to-rose-700",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function consultationPatientName(c: Consultation): string {
  if (!c.patient) return "";
  return Array.isArray(c.patient) ? c.patient[0]?.full_name ?? "" : c.patient.full_name;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function NavItem({
  icon,
  label,
  href,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  badge?: string;
  // Sidebar tabs without a real page of their own (e.g. "My Family")
  // used to be a bare same-page anchor link — which does nothing
  // *visible* on a wide screen where that section is already on
  // screen, making the tab feel broken even though it technically
  // worked (physician-reported, 2026-09-19). When onClick is given,
  // this renders as a button that runs it (in practice: open the
  // add-family-member form AND scroll to it) instead, so clicking it
  // always visibly does something regardless of viewport/scroll
  // position.
  onClick?: () => void;
}) {
  const className = `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
    active ? "bg-teal-50 text-teal-700" : "text-ink-500 hover:bg-[var(--background)]"
  }`;
  const content = (
    <>
      {icon}
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[9.5px] font-bold text-ink-400">
          {badge}
        </span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} w-full text-left`}>
        {content}
      </button>
    );
  }
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <a href={`#${label.toLowerCase().replace(/\s+/g, "-")}`} className={className}>
      {content}
    </a>
  );
}

export default function Dashboard() {
  const { session, loading, signOut } = useAuth();
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmittingId, setCancelSubmittingId] = useState<string | null>(null);
  const [cancelErrorId, setCancelErrorId] = useState<{ id: string; message: string } | null>(null);
  const [activeVouchers, setActiveVouchers] = useState<ActiveVoucher[] | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("family_members")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setFamilyError(error.message);
        } else {
          setFamilyMembers(data as FamilyMember[]);
        }
      });
  }, [session]);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("consultations")
      .select(
        "id, complaint, status, created_at, history_status, is_flagged, delivery_mode, patient:family_members(full_name), assessment:consultation_assessments(issued_at), scheduled_slot:doctor_availability_slots(start_time)"
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setFetchError(error.message);
        } else {
          setConsultations(data as Consultation[]);
        }
      });
  }, [session]);

  useEffect(() => {
    if (!session || !supabase) return;
    const client = supabase;
    let cancelled = false;

    client
      .from("consultation_followup_vouchers")
      .select("id, note, expires_at, created_at, doctor_id, patient:family_members(id, full_name)")
      .eq("status", "active")
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error || !data || data.length === 0) {
          setActiveVouchers(error ? null : []);
          return;
        }
        const doctorIds = Array.from(new Set(data.map((v) => v.doctor_id as string)));
        const { data: doctors } = await client
          .from("public_doctor_directory")
          .select("id, full_name")
          .in("id", doctorIds);
        const nameById = new Map((doctors ?? []).map((d) => [d.id as string, d.full_name as string]));
        if (cancelled) return;
        setActiveVouchers(
          (data as Omit<ActiveVoucher, "doctor_name">[]).map((v) => ({
            ...v,
            doctor_name: nameById.get(v.doctor_id) ?? null,
          }))
        );
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleCancel(consultationId: string) {
    if (!supabase) return;
    setCancelSubmittingId(consultationId);
    setCancelErrorId(null);
    const { error } = await supabase.rpc("cancel_consultation", {
      p_consultation_id: consultationId,
      p_reason: cancelReason.trim() || null,
    });
    setCancelSubmittingId(null);
    if (error) {
      setCancelErrorId({ id: consultationId, message: error.message });
      return;
    }
    // No automatic refund happens here or anywhere else — cancelling
    // only ever changes this consultation's status. If a refund is
    // warranted, that stays a deliberate admin decision made on the
    // /admin/refunds screen, same as every refund today (2026-09-16
    // physician decision).
    setConsultations((prev) =>
      prev ? prev.map((c) => (c.id === consultationId ? { ...c, status: "cancelled" } : c)) : prev
    );
    setCancelingId(null);
    setCancelReason("");
  }

  if (!isDatabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The database isn&rsquo;t connected yet, so there&rsquo;s no
          account system to show a dashboard for.
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="mx-auto max-w-md px-4 py-16 text-sm text-ink-500 sm:px-6">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-ink-border bg-white p-6 text-sm text-ink-700 shadow-sm">
          <p>You need to log in to see your dashboard.</p>
          <Link
            href="/login"
            className="mt-3 inline-block font-semibold text-teal-700 underline underline-offset-2"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  const fullName = session.user.user_metadata?.full_name || "there";
  const firstName = fullName.split(" ")[0] || "there";
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto flex max-w-6xl">
      {/* ============ SIDEBAR ============ */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-ink-border bg-white px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-brand-950 text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="text-sm font-extrabold tracking-tight text-ink-900">Family Medic</span>
        </div>

        <nav className="flex flex-col gap-1">
          <NavItem
            active
            href="/dashboard"
            label="Dashboard"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
              </svg>
            }
          />
          <NavItem
            label="My Family"
            onClick={() => {
              setShowAddForm(true);
              document.getElementById("my-family")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
          <NavItem
            label="Consultations"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              </svg>
            }
          />
          <NavItem
            label="Health Records"
            onClick={() =>
              document.getElementById("health-records")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" />
              </svg>
            }
          />
          <NavItem
            href="/feedback"
            label="Feedback & Support"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            }
          />
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-2xl bg-[var(--background)] p-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[0]} text-xs font-bold text-white`}>
            {initials(fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-ink-900">{fullName}</div>
            <button onClick={() => signOut()} className="text-[11.5px] font-semibold text-ink-500 hover:text-teal-700">
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[26px]">
              Hello, {firstName}
            </h1>
            <p className="mt-1 text-sm text-ink-500">{todayLabel}</p>
          </div>
          <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[0]} text-sm font-bold text-white sm:flex`}>
            {initials(fullName)}
          </span>
        </div>

        {/* Free follow-up banner (2026-09-18) — shown only when a
            doctor has actually granted a voucher (see FreeFollowUpVoucher
            on the doctor side); nothing renders here otherwise. */}
        {activeVouchers && activeVouchers.length > 0 && (
          <div className="mt-7 flex flex-col gap-3">
            {activeVouchers.map((v) => {
              const patient = Array.isArray(v.patient) ? v.patient[0] : v.patient;
              return (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-5 py-4"
                >
                  <div>
                    <p className="text-sm font-bold text-teal-900">
                      Free follow-up available{patient ? ` for ${patient.full_name}` : ""}
                      {v.doctor_name ? ` with ${v.doctor_name}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-teal-800/80">
                      {v.note ? `${v.note} — ` : ""}No payment needed for this visit
                      {v.expires_at ? ` if booked by ${new Date(v.expires_at).toLocaleDateString()}` : ""}.
                    </p>
                  </div>
                  <Link
                    href={`/book/followup/${v.id}`}
                    className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-sm"
                  >
                    Book your free follow-up
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions */}
        <div className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <Link href="/book" className="flex flex-col gap-3.5 rounded-2xl border border-ink-border bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M12 14v4M10 16h4" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">Book a consultation</div>
              <div className="mt-0.5 text-xs text-ink-500">Find a slot with your doctor</div>
            </div>
          </Link>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex flex-col gap-3.5 rounded-2xl border border-ink-border bg-white p-5 text-left shadow-sm transition hover:border-teal-200 hover:shadow-md"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">Add family member</div>
              <div className="mt-0.5 text-xs text-ink-500">Book care for someone you look after</div>
            </div>
          </button>
          <a href="#consultations" className="flex flex-col gap-3.5 rounded-2xl border border-ink-border bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">View consultations</div>
              <div className="mt-0.5 text-xs text-ink-500">See status and past visits</div>
            </div>
          </a>
          <Link href="/feedback" className="flex flex-col gap-3.5 rounded-2xl border border-ink-border bg-white p-5 shadow-sm transition hover:border-teal-200 hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.8l7-1L12 1.5l3 6.3 7 1-5 4.9 1.2 6.9z" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">Leave feedback</div>
              <div className="mt-0.5 text-xs text-ink-500">Rate a visit or report an issue</div>
            </div>
          </Link>
        </div>

        {/* Two column: consultations + family */}
        <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start">
          <div id="consultations" className="flex flex-1 flex-col gap-3.5 lg:w-0 lg:flex-[1.7]">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
                Your consultations
              </h2>
              <Link
                href="/book"
                className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                + Book a consultation
              </Link>
            </div>

            {fetchError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Couldn&rsquo;t load your consultations: {fetchError}
              </div>
            )}

            {!fetchError && consultations === null && (
              <p className="text-sm text-ink-400">Loading your consultations…</p>
            )}

            {!fetchError && consultations?.length === 0 && (
              <div className="rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
                No consultations yet. Booking one is the next step.
              </div>
            )}

            {!fetchError &&
              consultations &&
              consultations.map((c) => (
                <div key={c.id} className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-bold text-ink-900">{c.complaint}</p>
                      {consultationPatientName(c) && (
                        <p className="mt-0.5 text-xs text-ink-500">
                          For: {consultationPatientName(c)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[c.status] ?? "bg-[var(--background)] text-ink-500"}`}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                      {c.is_flagged && (
                        <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">
                          Flagged for priority review
                        </span>
                      )}
                      <span className="rounded-full bg-[var(--background)] px-2.5 py-1 text-[11px] font-bold text-ink-500">
                        {DELIVERY_MODE_LABEL[c.delivery_mode]}
                      </span>
                    </div>
                  </div>

                  {c.status !== "pending_payment" &&
                    c.status !== "completed" &&
                    c.status !== "cancelled" &&
                    c.delivery_mode !== "text" &&
                    (() => {
                    const slot = one(c.scheduled_slot);
                    return (
                      <p className="mt-2 text-xs font-medium text-amber-700">
                        {slot
                          ? `Scheduled ${DELIVERY_MODE_LABEL[c.delivery_mode].toLowerCase()}: ${new Date(slot.start_time).toLocaleString()}`
                          : `We'll contact you to arrange a time for this ${DELIVERY_MODE_LABEL[c.delivery_mode].toLowerCase()}.`}
                      </p>
                    );
                  })()}

                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-border pt-3.5">
                    <p className="text-xs text-ink-400">
                      {new Date(c.created_at).toLocaleString()}
                    </p>
                    <div className="flex flex-wrap gap-4">
                      {c.status === "pending_payment" ? (
                        <Link
                          href={`/consultation/${c.id}/payment`}
                          className="text-xs font-bold text-amber-700 underline underline-offset-2"
                        >
                          Complete payment
                        </Link>
                      ) : (
                        <>
                          {c.assessment && c.assessment.length > 0 && (
                            <Link
                              href={`/consultation/${c.id}/prescription`}
                              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                            >
                              View prescription
                            </Link>
                          )}
                          {c.delivery_mode === "text" && (
                            <Link
                              href={`/consultation/${c.id}/messages`}
                              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                            >
                              Messages
                            </Link>
                          )}
                          {c.delivery_mode !== "text" &&
                            c.status !== "completed" &&
                            c.status !== "cancelled" &&
                            one(c.scheduled_slot) && (
                            <Link
                              href={`/consultation/${c.id}/call`}
                              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                            >
                              Join call
                            </Link>
                          )}
                          <Link
                            href={`/consultation/${c.id}/history`}
                            className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                          >
                            {HISTORY_LINK_LABEL[c.history_status]}
                          </Link>
                          {c.status === "completed" && (
                            <Link
                              href={`/feedback?consultation=${c.id}`}
                              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                            >
                              Leave feedback
                            </Link>
                          )}
                          {c.status === "submitted" && (
                            <button
                              onClick={() => {
                                setCancelingId(c.id);
                                setCancelReason("");
                                setCancelErrorId(null);
                              }}
                              className="text-xs font-semibold text-red-700 underline underline-offset-2"
                            >
                              Cancel consultation
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {cancelingId === c.id && (
                    <div className="mt-3.5 rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-xs font-semibold text-red-800">
                        Cancel this consultation? This can&rsquo;t be undone.
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-red-700/80">
                        If you already paid, cancelling does not automatically
                        refund you — the clinic will review your case and get
                        back to you about any refund.
                      </p>
                      <textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Reason (optional)"
                        rows={2}
                        className="mt-2.5 w-full rounded-lg border border-red-200 bg-white p-2 text-xs text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-red-300"
                      />
                      {cancelErrorId?.id === c.id && (
                        <p className="mt-2 text-xs font-semibold text-red-800">{cancelErrorId.message}</p>
                      )}
                      <div className="mt-3 flex gap-3">
                        <button
                          onClick={() => handleCancel(c.id)}
                          disabled={cancelSubmittingId === c.id}
                          className="rounded-full bg-red-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm disabled:opacity-60"
                        >
                          {cancelSubmittingId === c.id ? "Cancelling…" : "Yes, cancel it"}
                        </button>
                        <button
                          onClick={() => {
                            setCancelingId(null);
                            setCancelErrorId(null);
                          }}
                          disabled={cancelSubmittingId === c.id}
                          className="text-xs font-semibold text-ink-500"
                        >
                          Never mind
                        </button>
                      </div>
                    </div>
                  )}

                  {c.status === "cancelled" && (
                    <p className="mt-3.5 border-t border-ink-border pt-3.5 text-[11.5px] text-ink-400">
                      Cancelled. If you paid for this consultation and believe
                      you&rsquo;re owed a refund, please{" "}
                      <Link href="/feedback" className="font-semibold text-teal-700 underline underline-offset-2">
                        contact the clinic
                      </Link>
                      .
                    </p>
                  )}
                </div>
              ))}
          </div>

          <div className="flex flex-col gap-5 lg:w-[340px] lg:shrink-0">
            <div id="my-family" className="rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
                  Family members
                </h2>
                {!showAddForm && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="text-xs font-bold text-teal-700"
                  >
                    + Add
                  </button>
                )}
              </div>

              {familyError && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  Couldn&rsquo;t load family members: {familyError}
                </div>
              )}

              {!familyError && familyMembers === null && (
                <p className="mt-3 text-xs text-ink-400">Loading…</p>
              )}

              {!familyError && familyMembers && familyMembers.length > 0 && (
                <div className="mt-3.5 flex flex-col gap-2">
                  {familyMembers.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-xl bg-[var(--background)] p-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[i % AVATAR_TONES.length]} text-[12.5px] font-bold text-white`}>
                        {initials(m.full_name)}
                      </span>
                      <span className="flex-1 truncate text-[13.5px] font-bold text-ink-900">{m.full_name}</span>
                      <span className="shrink-0 rounded-full border border-ink-border bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-500">
                        {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {showAddForm && (
                <div className="mt-4">
                  <AddFamilyMemberForm
                    onAdded={(member) => {
                      setFamilyMembers((prev) => [...(prev ?? []), member]);
                      setShowAddForm(false);
                    }}
                    onCancel={() => setShowAddForm(false)}
                  />
                </div>
              )}

              <p className="mt-3.5 text-[11.5px] leading-relaxed text-ink-400">
                Everyone listed here can have consultations booked for them
                from this account — no separate login needed for family
                members you add yourself.
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-brand-950 to-[#072522] p-5 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </span>
              <div className="mt-3.5 text-sm font-bold text-white">Need help with something?</div>
              <div className="mt-1.5 text-xs leading-relaxed text-white/65">
                Report a problem or a billing question — it goes straight to
                the clinic.
              </div>
              <Link href="/feedback" className="mt-4 inline-block text-xs font-bold text-teal-300">
                Contact / report an issue →
              </Link>
            </div>
          </div>
        </div>

        {/* Health Records (2026-09-19) — a standalone place to upload a
            report for a family member and see a summary of past,
            completed consultations. Previously a "soon" placeholder. */}
        <div id="health-records" className="mt-8">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
            Health records
          </h2>

          {familyError && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              Couldn&rsquo;t load family members: {familyError}
            </div>
          )}

          {!familyError && familyMembers === null && (
            <p className="mt-3 text-xs text-ink-400">Loading…</p>
          )}

          {!familyError && familyMembers && familyMembers.length === 0 && (
            <p className="mt-3 text-xs text-ink-400">
              Add a family member above to start keeping records for them.
            </p>
          )}

          {!familyError && familyMembers && familyMembers.length > 0 && (
            <div className="mt-3.5 grid gap-4 sm:grid-cols-2">
              {familyMembers.map((m) => (
                <PatientDocuments
                  key={m.id}
                  familyMemberId={m.id}
                  familyMemberName={m.full_name}
                  accountUserId={session.user.id}
                />
              ))}
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-ink-border bg-white p-5 shadow-sm">
            <h3 className="text-[13.5px] font-bold text-ink-900">Past consultation summary</h3>
            {!fetchError && consultations === null && (
              <p className="mt-3 text-xs text-ink-400">Loading…</p>
            )}
            {!fetchError &&
              consultations &&
              consultations.filter((c) => c.status === "completed").length === 0 && (
                <p className="mt-3 text-xs text-ink-400">No completed consultations yet.</p>
              )}
            {!fetchError && consultations && consultations.filter((c) => c.status === "completed").length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {consultations
                  .filter((c) => c.status === "completed")
                  .map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--background)] p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-ink-900">
                          {c.complaint}
                          {consultationPatientName(c) ? ` — ${consultationPatientName(c)}` : ""}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-400">
                          {new Date(c.created_at).toLocaleDateString()} · {DELIVERY_MODE_LABEL[c.delivery_mode]}
                        </div>
                      </div>
                      {c.assessment && c.assessment.length > 0 && (
                        <Link
                          href={`/consultation/${c.id}/prescription`}
                          className="shrink-0 text-[11.5px] font-bold text-teal-700 underline underline-offset-2"
                        >
                          View prescription
                        </Link>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
