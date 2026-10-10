import Link from "next/link";

// New look (2026-10): deep-teal footer to match the new header. Same
// pages as before, plus the two front doors (patient / doctor) and the
// app-install link. The stale "we ask about your symptoms and health
// history" sentence was removed — the guided questionnaire was retired
// on 2026-10-06 — and the "every clinical decision is the doctor's"
// promise is kept.
export default function Footer() {
  const linkClass = "text-teal-50/80 transition hover:text-white";
  const headClass = "text-xs font-bold uppercase tracking-[0.12em] text-teal-300";
  return (
    <footer className="mt-auto bg-[#0a3733] text-teal-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-7.5-4.6-10-9.5C.3 7.7 2.2 4 6 4c2.1 0 3.6 1.1 4.5 2.4L12 8l1.5-1.6C14.4 5.1 15.9 4 18 4c3.8 0 5.7 3.7 4 7.5-2.5 4.9-10 9.5-10 9.5z" />
                </svg>
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[15px] font-extrabold tracking-tight text-white">Family Medic</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-200">
                  Digital Family Clinic
                </span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-teal-50/75">
              Your family doctor, available digitally. Real physician care for every member of your family, real
              decisions.
            </p>
          </div>

          <div>
            <p className={headClass}>Platform</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/how-it-works" className={linkClass}>How It Works</Link></li>
              <li><Link href="/doctors" className={linkClass}>Our Doctors</Link></li>
              <li><Link href="/services" className={linkClass}>Services</Link></li>
              <li><Link href="/about" className={linkClass}>About</Link></li>
              <li><Link href="/faq" className={linkClass}>FAQ</Link></li>
            </ul>
          </div>

          <div>
            <p className={headClass}>Log in</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/login" className={linkClass}>Patient Login</Link></li>
              <li><Link href="/register" className={linkClass}>Create a patient account</Link></li>
              <li><Link href="/doctor/login" className={linkClass}>Doctor Login</Link></li>
              <li><Link href="/doctor/register" className={linkClass}>Join as a doctor</Link></li>
              <li><Link href="/#app" className={linkClass}>Get the free app</Link></li>
            </ul>
          </div>

          <div>
            <p className={headClass}>Legal &amp; Contact</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/privacy" className={linkClass}>Privacy Policy</Link></li>
              <li><Link href="/terms" className={linkClass}>Terms of Service</Link></li>
              <li><Link href="/refund-policy" className={linkClass}>Refund &amp; Cancellation</Link></li>
              <li><Link href="/contact" className={linkClass}>Contact</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-xs leading-relaxed text-teal-50/65">
            Your doctor makes every clinical decision &mdash; diagnosis and prescriptions are never generated
            automatically. Not for emergencies: if you need urgent help, contact your local emergency service.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-teal-50/65">
            <p>© {new Date().getFullYear()} Family Medic.</p>
            <Link href="/admin/login" className="transition hover:text-white">
              Admin Login
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
