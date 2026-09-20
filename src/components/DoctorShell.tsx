"use client";

import Link from "next/link";

// Shared doctor-workspace shell (2026-09-20). Previously this sidebar
// only existed as a private function inside src/app/doctor/page.tsx
// (the dashboard/overview) — every other doctor page
// (/doctor/queue, /doctor/availability, /doctor/profile) used the
// generic public-site `PageHeader` instead, with no sidebar at all.
// That's the real bug behind "the doctor dashboard looks like a
// duplicate of the patient one / everything looks inconsistent":
// navigating from the dashboard into the queue made the whole
// workspace nav disappear and land on what looked like a plain
// content page. Pulling the shell out into its own component and
// using it on all four logged-in doctor pages fixes that — one
// persistent sidebar for the whole doctor side, same as the patient
// dashboard already has for its own section.
//
// `active` picks which sidebar item is highlighted; nothing else
// about any page's data loading or actions changes by using this.

export type DoctorShellActive = "dashboard" | "queue" | "availability" | "profile";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function SidebarLink({
  icon,
  label,
  href,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
        active ? "bg-teal-50 text-teal-700" : "text-ink-500 hover:bg-[var(--background)]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function DoctorShell({
  children,
  doctorName,
  onSignOut,
  active,
}: {
  children: React.ReactNode;
  doctorName?: string;
  onSignOut?: () => void;
  active?: DoctorShellActive;
}) {
  return (
    <div className="mx-auto flex max-w-6xl">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-ink-border bg-white px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-brand-950 text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="text-sm font-extrabold tracking-tight text-ink-900">Doctor Workspace</span>
        </div>

        <nav className="flex flex-col gap-1">
          <SidebarLink
            active={active === "dashboard"}
            href="/doctor"
            label="Dashboard"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
              </svg>
            }
          />
          <SidebarLink
            active={active === "queue"}
            href="/doctor/queue"
            label="Consultation Queue"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 4v5" />
              </svg>
            }
          />
          <SidebarLink
            active={active === "availability"}
            href="/doctor/availability"
            label="Availability"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><circle cx="12" cy="15" r="2.2" />
              </svg>
            }
          />
          <SidebarLink
            active={active === "profile"}
            href="/doctor/profile"
            label="My Profile"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
              </svg>
            }
          />
        </nav>

        {doctorName && (
          <div className="mt-auto flex items-center gap-2.5 rounded-2xl bg-[var(--background)] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-xs font-bold text-white">
              {initials(doctorName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-ink-900">{doctorName}</div>
              {onSignOut && (
                <button onClick={onSignOut} className="text-[11.5px] font-semibold text-ink-500 hover:text-teal-700">
                  Log out
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:py-10">{children}</div>
    </div>
  );
}
