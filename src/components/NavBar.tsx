"use client";

import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";

const links = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/services", label: "Services" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function NavBar() {
  const { session, signOut } = useAuth();
  const firstName = session?.user.user_metadata?.full_name?.split(" ")?.[0];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-ink-border)] bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-brand-950 text-white shadow-sm">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
            </svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-extrabold tracking-tight text-ink-900">
              Family Medic
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
              Digital Family Clinic
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-semibold text-ink-700 transition hover:text-teal-700"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link
                href="/dashboard"
                className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink-700 hover:text-teal-700 sm:inline-block"
              >
                {firstName ? `Hi, ${firstName}` : "My Account"}
              </Link>
              <button
                onClick={() => signOut()}
                className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink-500 hover:text-teal-700 sm:inline-block"
              >
                Log out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink-700 hover:text-teal-700 sm:inline-block"
            >
              Log in
            </Link>
          )}
          <Link
            href="/book"
            className="rounded-full bg-gradient-to-b from-teal-600 to-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-900/10 transition hover:from-teal-700 hover:to-teal-800"
          >
            Book Consultation
          </Link>
        </div>
      </div>

      {/* mobile nav */}
      <nav className="flex gap-4 overflow-x-auto border-t border-[var(--color-ink-border)] px-4 py-2 md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="whitespace-nowrap text-xs font-semibold text-ink-700"
          >
            {l.label}
          </Link>
        ))}
        {session ? (
          <>
            <Link href="/dashboard" className="whitespace-nowrap text-xs font-semibold text-ink-700">
              {firstName ? `Hi, ${firstName}` : "My Account"}
            </Link>
            <button onClick={() => signOut()} className="whitespace-nowrap text-xs font-semibold text-ink-500">
              Log out
            </button>
          </>
        ) : (
          <Link href="/login" className="whitespace-nowrap text-xs font-semibold text-ink-700">
            Log in
          </Link>
        )}
      </nav>
    </header>
  );
}
