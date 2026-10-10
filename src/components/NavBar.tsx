"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";
import { useDoctorProfile } from "@/lib/doctor";
import { useAdminProfile } from "@/lib/admin";
import PushOptIn from "@/components/PushOptIn";

const links = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/doctors", label: "Our Doctors" },
  { href: "/services", label: "Services" },
  { href: "/calculators", label: "Free Tools" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function NavBar() {
  const { session, signOut } = useAuth();
  const firstName = session?.user.user_metadata?.full_name?.split(" ")?.[0];
  // Bug fix (2026-09-20, physician: doctor login was landing on the
  // patient dashboard): this header renders on every page, including
  // every /doctor/* page, and used to send "Hi, {name}" to /dashboard
  // unconditionally — correct for a patient, wrong for a doctor. A
  // doctor's own auth account has a matching row in `doctor_profiles`
  // (same check every /doctor/* page already runs via this shared
  // hook — see src/lib/doctor.ts), so once that resolves, route the
  // account link to /doctor instead.
  //
  // Bug fix, round 2 (2026-09-22, physician: "Hi, doctor" on the admin
  // portal sent me to the doctor dashboard"): this header renders on
  // EVERY page including every /admin/* page, and the fix above never
  // accounted for admin at all — it only ever asked "does this account
  // have a doctor_profiles row?", regardless of which part of the site
  // is actually being viewed. An account can be a doctor AND an admin
  // at the same time (src/lib/admin.ts's own comment: "today, the
  // physician is both"), so that first fix silently sent every admin
  // who is also a doctor to /doctor, every single time, with no way to
  // tell from this header alone that /admin was ever an option. Fix:
  // check admin status too, and prefer it — an admin account should
  // always land back on /admin from this link, never get routed to a
  // different portal just because it also happens to hold a doctor
  // profile. Priority is admin > doctor > patient; while either check
  // is still resolving (undefined, right after login) this falls back
  // to /dashboard, same as before.
  const { profile: doctorProfile } = useDoctorProfile();
  const { profile: adminProfile } = useAdminProfile();
  const accountHref = adminProfile ? "/admin" : doctorProfile ? "/doctor" : "/dashboard";

  // Push-notification opt-in (2026-10-01): deliberately placed here,
  // once, rather than inside DoctorShell/AdminGuard/the patient
  // dashboard separately — this header already renders on every single
  // page regardless of role (that's exactly what the two bug fixes
  // above are about), so one instance here covers patients, doctors,
  // and admins at once with no duplication. Shown next to the account
  // link whenever someone is logged in, on both the desktop and mobile
  // layouts below (it's a single small icon button, so no need for a
  // separate "hidden sm:inline-block" treatment the text links need).
  const pushOptIn = session ? <PushOptIn accountId={session.user.id} /> : null;

  // New look (2026-10): the two pages that open with their own dark
  // hero — the homepage and the doctors directory — get a deep-teal
  // header that melts into it; every other page keeps a light header.
  // Purely visual: same links, same signed-in/out logic as above.
  const pathname = usePathname();
  const dark = pathname === "/" || pathname === "/doctors" || pathname.startsWith("/doctors/");
  const [loginOpen, setLoginOpen] = useState(false);
  useEffect(() => {
    setLoginOpen(false);
  }, [pathname]);

  const t = dark
    ? {
        header: "sticky top-0 z-40 border-b border-white/10 bg-[#0a3733]",
        name: "text-white",
        sub: "text-teal-200",
        link: "text-teal-50/85 hover:text-white",
        row2: "border-t border-white/10",
        ghost:
          "border border-white/40 text-white hover:bg-white/10",
        quiet: "text-teal-50/85 hover:text-white",
        strip: "border-t border-white/10 text-teal-50/90",
        stripQuiet: "text-teal-200",
        pop: "border-white/15 bg-[#0a3733] text-white",
        popItem: "hover:bg-white/10",
      }
    : {
        header: "sticky top-0 z-40 border-b border-[var(--color-ink-border)] bg-white/90 backdrop-blur",
        name: "text-ink-900",
        sub: "text-ink-400",
        link: "text-ink-700 hover:text-teal-700",
        row2: "border-t border-[var(--color-ink-border)]",
        ghost: "border border-teal-700/40 text-teal-800 hover:bg-teal-50",
        quiet: "text-ink-700 hover:text-teal-700",
        strip: "border-t border-[var(--color-ink-border)] text-ink-700",
        stripQuiet: "text-ink-500",
        pop: "border-[var(--color-ink-border)] bg-white text-ink-900",
        popItem: "hover:bg-teal-50",
      };

  const bookClass =
    "rounded-full bg-[#ffb454] px-4 py-2 text-sm font-extrabold text-[#3b2500] shadow-sm shadow-black/10 transition hover:bg-[#ffc272] sm:px-5 sm:py-2.5";

  return (
    <header className={t.header}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm ring-1 ring-black/5">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className={`text-[15.5px] font-extrabold tracking-tight ${t.name}`}>Family Medic</span>
            <span className={`hidden text-[10px] font-bold uppercase tracking-[0.14em] sm:block ${t.sub}`}>Digital Family Clinic</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <Link
            href="/#app"
            className={`hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition lg:inline-flex ${t.quiet}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            Get the app
          </Link>

          {session ? (
            <>
              {/* Desktop only (md+): below that the same icon already
                  sits in the mobile strip below, which showed two bells. */}
              <span className="hidden md:inline-flex">{pushOptIn}</span>
              <Link
                href={accountHref}
                className={`hidden rounded-full px-3 py-2 text-sm font-semibold sm:inline-block ${t.quiet}`}
              >
                {firstName ? `Hi, ${firstName}` : "My Account"}
              </Link>
              <button
                onClick={() => signOut()}
                className={`hidden rounded-full px-3 py-2 text-sm font-semibold sm:inline-block ${t.quiet}`}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              {/* Two clearly separate front doors (physician, 2026-10):
                  patients and doctors should never have to guess which
                  login is theirs. */}
              <Link
                href="/login"
                className={`hidden items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition sm:inline-flex ${t.ghost}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
                Patient Login
              </Link>
              <Link
                href="/doctor/login"
                className={`hidden items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition sm:inline-flex ${t.ghost}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2" />
                  <circle cx="20" cy="11" r="2" />
                </svg>
                Doctor Login
              </Link>
              {/* Phones: one "Log in" button that opens the same two doors. */}
              <div className="relative sm:hidden">
                <button
                  type="button"
                  onClick={() => setLoginOpen((v) => !v)}
                  aria-expanded={loginOpen}
                  aria-haspopup="true"
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-bold ${t.ghost}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                  </svg>
                  Log in
                </button>
                {loginOpen && (
                  <div className={`absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border p-1.5 shadow-xl ${t.pop}`}>
                    <Link href="/login" className={`block rounded-xl px-3 py-2.5 text-sm font-bold ${t.popItem}`}>
                      Patient Login
                      <span className="block text-[11px] font-medium opacity-70">Book and manage visits</span>
                    </Link>
                    <Link href="/doctor/login" className={`block rounded-xl px-3 py-2.5 text-sm font-bold ${t.popItem}`}>
                      Doctor Login
                      <span className="block text-[11px] font-medium opacity-70">Your queue and earnings</span>
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
          <Link href="/book" className={bookClass}>
            <span className="hidden sm:inline">Book Consultation</span>
            <span className="sm:hidden">Book</span>
          </Link>
        </div>
      </div>

      {/* desktop links (second row, so no link is ever dropped) */}
      <nav className={`hidden items-center justify-center gap-7 py-2 md:flex ${t.row2}`}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`text-[13.5px] font-semibold transition ${t.link}`}>
            {l.label}
          </Link>
        ))}
      </nav>

      {/* mobile nav */}
      <nav className={`flex items-center gap-4 overflow-x-auto px-4 py-2 md:hidden ${t.strip}`}>
        {session && (
          <>
            <Link href={accountHref} className="whitespace-nowrap text-xs font-semibold">
              {firstName ? `Hi, ${firstName}` : "My Account"}
            </Link>
            <button onClick={() => signOut()} className={`whitespace-nowrap text-xs font-semibold ${t.stripQuiet}`}>
              Log out
            </button>
            {pushOptIn}
          </>
        )}
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="whitespace-nowrap text-xs font-semibold">
            {l.label}
          </Link>
        ))}
        <Link href="/#app" className={`whitespace-nowrap text-xs font-semibold ${t.stripQuiet}`}>
          Get the app
        </Link>
      </nav>
    </header>
  );
}
