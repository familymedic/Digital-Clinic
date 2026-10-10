"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";
import { supabase, isDatabaseConfigured } from "@/lib/supabaseClient";
import { RELATIONSHIPS, RELATIONSHIP_LABEL, type FamilyMember } from "@/lib/family";
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
  // The raw FK, alongside the nested `patient` lookup below — needed so
  // the dashboard can filter/group consultations by family member
  // client-side without a second round-trip (2026-09-27: "sort by
  // family member" / clicking a family member's name).
  patient_id: string;
  patient: { full_name: string } | { full_name: string }[] | null;
  // Only ever non-empty once a doctor has Approved & Issued a
  // prescription for this consultation — RLS (0018) only returns an
  // assessment row here once status = 'issued', so this array's
  // presence alone is a safe "has an issued prescription" signal, no
  // separate status check needed.
  //
  // Shape fix (2026-10-06): consultation_assessments.consultation_id is
  // UNIQUE, so PostgREST returns this embed as a single OBJECT (or null),
  // not an array. The old `c.assessment.length > 0` check was therefore
  // always false and the "View prescription" link never appeared for any
  // patient. Both shapes are accepted now; use hasPrescription().
  assessment: { issued_at: string | null } | { issued_at: string | null }[] | null;
}

function hasPrescription(c: { assessment: Consultation["assessment"] }): boolean {
  if (!c.assessment) return false;
  return Array.isArray(c.assessment) ? c.assessment.length > 0 : true;
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
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  badge?: string;
}) {
  const className = `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
    active ? "bg-white/15 text-white shadow-[inset_3px_0_0_#ffb454]" : "text-teal-100/80 hover:bg-white/10 hover:text-white"
  }`;
  const content = (
    <>
      {icon}
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9.5px] font-bold text-teal-100">
          {badge}
        </span>
      )}
    </>
  );
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

  // "Clicked on a family member's name but nothing happened" (2026-09-27)
  // — filtering the consultation list by family member. `null` means no
  // filter (show everyone), matching the default state on first load.
  const [filterFamilyId, setFilterFamilyId] = useState<string | null>(null);

  // Family member edit/remove (2026-09-27) — remove is a soft archive
  // (migration 0048), never a real delete, since consultations/documents
  // reference this row and a clinical record reads as permanent in this
  // app (see the migration's own comment).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRelationship, setEditRelationship] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from("family_members")
      .select("*")
      .is("archived_at", null)
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
        "id, complaint, status, created_at, history_status, is_flagged, delivery_mode, patient_id, patient:family_members(full_name), assessment:consultation_assessments(issued_at), scheduled_slot:doctor_availability_slots(start_time)"
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

  function startEdit(m: FamilyMember) {
    setEditingId(m.id);
    setEditName(m.full_name);
    setEditRelationship(m.relationship);
    setEditDob(m.date_of_birth ?? "");
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    if (!supabase) return;
    if (editName.trim().length < 2) {
      setEditError("Please enter a full name.");
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    const { data, error } = await supabase
      .from("family_members")
      .update({
        full_name: editName.trim(),
        relationship: editRelationship,
        date_of_birth: editDob || null,
      })
      .eq("id", id)
      .select()
      .single();
    setEditSubmitting(false);
    if (error) {
      setEditError(error.message);
      return;
    }
    setFamilyMembers((prev) =>
      prev ? prev.map((m) => (m.id === id ? (data as FamilyMember) : m)) : prev
    );
    setEditingId(null);
  }

  async function handleRemove(id: string) {
    if (!supabase) return;
    setRemoveSubmitting(true);
    setRemoveError(null);
    const { error } = await supabase
      .from("family_members")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    setRemoveSubmitting(false);
    if (error) {
      setRemoveError(error.message);
      return;
    }
    setFamilyMembers((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    if (filterFamilyId === id) setFilterFamilyId(null);
    setRemovingId(null);
  }

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
      <aside className="hidden w-64 shrink-0 flex-col gap-6 bg-[#0a3733] px-4 py-6 text-white lg:flex lg:rounded-br-[32px]">
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="text-sm font-extrabold tracking-tight text-white">Family Medic</span>
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

        <div className="mt-auto flex items-center gap-2.5 rounded-2xl bg-white/10 p-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[0]} text-xs font-bold text-white`}>
            {initials(fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-white">{fullName}</div>
            <button onClick={() => signOut()} className="text-[11.5px] font-semibold text-teal-200 hover:text-white">
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex items-center justify-between gap-4 rounded-[28px] bg-[radial-gradient(600px_260px_at_90%_-20%,rgba(45,212,191,0.28),transparent_60%),linear-gradient(135deg,#0a3733,#072927)] px-6 py-7 text-white shadow-[0_20px_50px_-28px_rgba(7,41,39,0.7)] sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-200">{todayLabel}</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-white sm:text-[30px]">
              Hello, {firstName}
            </h1>
            <p className="mt-1 text-sm text-teal-100/80">How can we help your family today?</p>
          </div>
          <span className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-300 to-teal-600 text-sm font-extrabold text-[#06312e] sm:flex`}>
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
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Link href="/book" className="flex flex-col gap-3.5 rounded-3xl bg-white p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] transition hover:-translate-y-0.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
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
            className="flex flex-col gap-3.5 rounded-3xl bg-white p-5 text-left shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] transition hover:-translate-y-0.5"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">Add family member</div>
              <div className="mt-0.5 text-xs text-ink-500">Book care for someone you look after</div>
            </div>
          </button>
          <a href="#consultations" className="flex flex-col gap-3.5 rounded-3xl bg-white p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] transition hover:-translate-y-0.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
              </svg>
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-ink-900">View consultations</div>
              <div className="mt-0.5 text-xs text-ink-500">See status and past visits</div>
            </div>
          </a>
          <Link href="/feedback" className="flex flex-col gap-3.5 rounded-3xl bg-white p-5 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)] transition hover:-translate-y-0.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
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
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-teal-700">
                Your consultations
              </h2>
              <Link
                href="/book"
                className="rounded-full bg-[#ffb454] px-4 py-2 text-xs font-extrabold text-[#3b2500] shadow-[0_8px_20px_-10px_rgba(255,180,84,0.9)] hover:bg-[#ffc272]"
              >
                + Book a consultation
              </Link>
            </div>

            {/* Family-member filter (2026-09-27) — set by clicking a
                family member's name here or in the sidebar list below. */}
            {filterFamilyId && (
              <div className="flex items-center gap-2 rounded-xl bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800">
                Showing consultations for{" "}
                {familyMembers?.find((m) => m.id === filterFamilyId)?.full_name ?? "this family member"}
                <button
                  onClick={() => setFilterFamilyId(null)}
                  className="ml-auto font-bold text-teal-700 underline underline-offset-2"
                >
                  Clear filter
                </button>
              </div>
            )}

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
              consultations.length > 0 &&
              consultations.filter((c) => !filterFamilyId || c.patient_id === filterFamilyId).length === 0 && (
                <div className="rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
                  No consultations for this family member yet.
                </div>
              )}

            {!fetchError &&
              consultations &&
              consultations
                .filter((c) => !filterFamilyId || c.patient_id === filterFamilyId)
                .map((c) => (
                <div key={c.id} className="rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-bold text-ink-900">{c.complaint}</p>
                      {consultationPatientName(c) && (
                        <button
                          onClick={() => setFilterFamilyId(c.patient_id)}
                          className="mt-0.5 text-xs text-ink-500 underline decoration-dotted underline-offset-2 hover:text-teal-700"
                          title="Show only this family member's consultations"
                        >
                          For: {consultationPatientName(c)}
                        </button>
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
                          {hasPrescription(c) && (
                            <Link
                              href={`/consultation/${c.id}/prescription`}
                              className="text-xs font-semibold text-teal-700 underline underline-offset-2"
                            >
                              View / download prescription
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
            <div id="my-family" className="rounded-3xl bg-white p-6 shadow-[0_14px_36px_-22px_rgba(7,41,39,0.35)]">
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
                  {familyMembers.map((m, i) =>
                    editingId === m.id ? (
                      <div key={m.id} className="rounded-xl border border-teal-200 bg-teal-50 p-3">
                        {editError && <p className="mb-2 text-[11px] font-semibold text-red-700">{editError}</p>}
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Full name"
                          className="w-full rounded-md border border-ink-border px-2.5 py-1.5 text-xs"
                        />
                        <div className="mt-2 flex gap-2">
                          <select
                            value={editRelationship}
                            onChange={(e) => setEditRelationship(e.target.value)}
                            className="w-1/2 rounded-md border border-ink-border px-2 py-1.5 text-xs"
                            disabled={m.relationship === "self"}
                          >
                            {m.relationship === "self" ? (
                              <option value="self">You</option>
                            ) : (
                              RELATIONSHIPS.map((r) => (
                                <option key={r.value} value={r.value}>
                                  {r.label}
                                </option>
                              ))
                            )}
                          </select>
                          <input
                            type="date"
                            value={editDob}
                            onChange={(e) => setEditDob(e.target.value)}
                            className="w-1/2 rounded-md border border-ink-border px-2 py-1.5 text-xs"
                          />
                        </div>
                        <div className="mt-2.5 flex gap-3">
                          <button
                            onClick={() => handleSaveEdit(m.id)}
                            disabled={editSubmitting}
                            className="rounded-full bg-teal-700 px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-60"
                          >
                            {editSubmitting ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={editSubmitting}
                            className="text-[11.5px] font-semibold text-ink-500"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : removingId === m.id ? (
                      <div key={m.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
                        {removeError && <p className="mb-2 text-[11px] font-semibold text-red-700">{removeError}</p>}
                        <p className="text-xs font-semibold text-red-800">
                          Remove {m.full_name} from your family list?
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-red-700/80">
                          Their past consultations, prescriptions, and uploaded
                          documents stay exactly as they are — this only
                          removes them from this list and from who you can
                          book a new consultation for.
                        </p>
                        <div className="mt-2.5 flex gap-3">
                          <button
                            onClick={() => handleRemove(m.id)}
                            disabled={removeSubmitting}
                            className="rounded-full bg-red-700 px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-60"
                          >
                            {removeSubmitting ? "Removing…" : "Yes, remove"}
                          </button>
                          <button
                            onClick={() => setRemovingId(null)}
                            disabled={removeSubmitting}
                            className="text-[11.5px] font-semibold text-ink-500"
                          >
                            Never mind
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex items-center gap-3 rounded-xl bg-[var(--background)] p-2.5">
                        <button
                          onClick={() => setFilterFamilyId(m.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          title="Show only this family member's consultations"
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_TONES[i % AVATAR_TONES.length]} text-[12.5px] font-bold text-white`}>
                            {initials(m.full_name)}
                          </span>
                          <span className="flex-1 truncate text-[13.5px] font-bold text-ink-900">{m.full_name}</span>
                        </button>
                        <span className="shrink-0 rounded-full border border-ink-border bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-500">
                          {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship}
                        </span>
                        <button
                          onClick={() => startEdit(m)}
                          className="shrink-0 text-[11px] font-bold text-ink-400 hover:text-teal-700"
                          title="Edit"
                        >
                          Edit
                        </button>
                        {m.relationship !== "self" && (
                          <button
                            onClick={() => {
                              setRemovingId(m.id);
                              setRemoveError(null);
                            }}
                            className="shrink-0 text-[11px] font-bold text-ink-400 hover:text-red-700"
                            title="Remove"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )
                  )}
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

            <div className="rounded-3xl bg-gradient-to-br from-brand-950 to-[#072522] p-6 shadow-sm">
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

        {/* Health records (2026-09-27) — was a "soon" placeholder in the
            sidebar with nothing behind it; now a real section, one card
            per active family member: report upload/view (PatientDocuments,
            migration 0042) plus that person's own past-consultation
            summary with a link to any issued prescription. */}
        <div id="health-records" className="mt-8">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">
            Health records
          </h2>

          {!familyError && familyMembers === null && (
            <p className="mt-3 text-sm text-ink-400">Loading…</p>
          )}

          {!familyError && familyMembers && familyMembers.length === 0 && (
            <div className="mt-3 rounded-2xl border border-dashed border-ink-border bg-white p-8 text-center text-sm text-ink-500">
              Add a family member above to start keeping records for them.
            </div>
          )}

          {!familyError && familyMembers && familyMembers.length > 0 && (
            <div className="mt-3.5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {familyMembers.map((m) => {
                const pastConsultations = (consultations ?? []).filter(
                  (c) => c.patient_id === m.id && (c.status === "completed" || c.status === "cancelled")
                );
                return (
                  <div key={m.id} className="flex flex-col gap-3">
                    <PatientDocuments
                      familyMemberId={m.id}
                      familyMemberName={m.full_name}
                      accountUserId={session.user.id}
                    />
                    {pastConsultations.length > 0 && (
                      <div className="rounded-2xl border border-ink-border bg-white p-4">
                        <h3 className="text-[11.5px] font-extrabold uppercase tracking-wider text-ink-400">
                          Past consultations
                        </h3>
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {pastConsultations.map((c) => (
                            <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-ink-700">
                                {c.complaint} · {new Date(c.created_at).toLocaleDateString()}
                              </span>
                              {hasPrescription(c) && (
                                <Link
                                  href={`/consultation/${c.id}/prescription`}
                                  className="shrink-0 font-semibold text-teal-700 underline underline-offset-2"
                                >
                                  Prescription
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
